import { useState, useMemo } from 'react';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';

// ── Shared chart style ─────────────────────────────────────────────────────
const CS = {
  grid: { strokeDasharray: '3 3', stroke: 'var(--border)' },
  ax:   { stroke: 'var(--border)', tick: { fill: 'var(--text-muted)', fontSize: 11 } },
  tip:  { contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 } },
};

function SectionHeader({ title, color = '#6366f1' }: { title: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{ width: 4, height: 22, borderRadius: 2, background: color }} />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-h)' }}>{title}</h2>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ padding: '4px 10px', background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 6, fontSize: 11, fontWeight: 600, color, letterSpacing: '0.05em' }}>
      {label}
    </div>
  );
}

function InfoBox({ title, children, color = '#6366f1' }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ padding: '16px 18px', background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 10, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.05em', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, color = '#6366f1' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 120, padding: '16px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Iron Condor P&L diagram ────────────────────────────────────────────────
function IronCondorDiagram({ spxSpot, callShort, callLong, putShort, putLong, credit }: {
  spxSpot: number; callShort: number; callLong: number; putShort: number; putLong: number; credit: number;
}) {
  const data = useMemo(() => {
    const range: { price: number; pnl: number }[] = [];
    const lo = putLong - 30;
    const hi = callLong + 30;
    for (let p = lo; p <= hi; p += 2) {
      let pnl = credit * 100;
      // Put spread
      if (p <= putLong) pnl -= (putShort - putLong) * 100;
      else if (p < putShort) pnl -= (putShort - p) * 100;
      // Call spread
      if (p >= callLong) pnl -= (callLong - callShort) * 100;
      else if (p > callShort) pnl -= (p - callShort) * 100;
      range.push({ price: p, pnl: +pnl.toFixed(0) });
    }
    return range;
  }, [callShort, callLong, putShort, putLong, credit]);

  const maxLoss = -(Math.max(callLong - callShort, putShort - putLong) - credit) * 100;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="lossGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <CartesianGrid {...CS.grid} />
        <XAxis dataKey="price" {...CS.ax} label={{ value: 'SPX Price at Expiry', position: 'insideBottom', offset: -2, fill: 'var(--text-muted)', fontSize: 11 }} />
        <YAxis {...CS.ax} tickFormatter={v => `$${v}`} />
        <Tooltip {...CS.tip} formatter={(v: number) => [`$${v}`, 'P&L']} labelFormatter={l => `SPX @ ${l}`} />
        <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
        <ReferenceLine x={spxSpot} stroke="#6366f1" strokeDasharray="4 4" label={{ value: 'Spot', fill: '#6366f1', fontSize: 10, position: 'top' }} />
        <Area type="monotone" dataKey="pnl" stroke="#10b981" strokeWidth={2}
          fill="url(#profitGrad)"
          dot={false}
          activeDot={{ r: 4, fill: '#10b981' }}
        />
        <ReferenceLine y={maxLoss} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Max Loss', fill: '#ef4444', fontSize: 10, position: 'right' }} />
        <ReferenceLine y={credit * 100} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'Max Profit', fill: '#10b981', fontSize: 10, position: 'right' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Monthly outcome data (illustrative community-aggregated ~2021-2025) ────
const monthlyData = [
  { month: 'Jan', result: 1.8, type: 'win' },
  { month: 'Feb', result: 2.1, type: 'win' },
  { month: 'Mar', result: -0.9, type: 'loss' },
  { month: 'Apr', result: 1.5, type: 'win' },
  { month: 'May', result: 2.3, type: 'win' },
  { month: 'Jun', result: 0.4, type: 'win' },
  { month: 'Jul', result: 1.9, type: 'win' },
  { month: 'Aug', result: -1.2, type: 'loss' },
  { month: 'Sep', result: 2.0, type: 'win' },
  { month: 'Oct', result: -0.5, type: 'loss' },
  { month: 'Nov', result: 1.7, type: 'win' },
  { month: 'Dec', result: 1.4, type: 'win' },
];

// Entry tranche timing (afternoon entries, illustrative win rate by tranche)
const trancheData = [
  { entry: '1:00 PM', winRate: 58, avgCredit: 1.30 },
  { entry: '1:30 PM', winRate: 61, avgCredit: 1.25 },
  { entry: '2:00 PM', winRate: 63, avgCredit: 1.20 },
  { entry: '2:30 PM', winRate: 65, avgCredit: 1.15 },
  { entry: '3:00 PM', winRate: 64, avgCredit: 1.10 },
];

// Regime performance
const regimeData = [
  { regime: 'Low Vol (VIX<15)', avgReturn: 2.1, winRate: 68, drawdown: 2.1 },
  { regime: 'Normal (VIX 15-25)', avgReturn: 1.7, winRate: 62, drawdown: 4.3 },
  { regime: 'High Vol (VIX 25-35)', avgReturn: 0.6, winRate: 51, drawdown: 9.8 },
  { regime: 'Crisis (VIX>35)', avgReturn: -2.4, winRate: 35, drawdown: 18.2 },
];

// Double-stop frequency by year
const doubleStopData = [
  { year: '2021', freq: 4.2 },
  { year: '2022', freq: 9.1 },
  { year: '2023', freq: 5.8 },
  { year: '2024', freq: 11.3 },
  { year: '2025', freq: 8.7 },
];

// ── Interactive trade calculator ───────────────────────────────────────────
function MEICCalculator() {
  const [spxSpot, setSpxSpot] = useState(5600);
  const [spreadWidth, setSpreadWidth] = useState(50);
  const [creditPerSide, setCreditPerSide] = useState(1.25);
  const [tranches, setTranches] = useState(5);
  const [contracts, setContracts] = useState(1);

  const callShort = spxSpot + 30;
  const callLong  = callShort + spreadWidth;
  const putShort  = spxSpot - 30;
  const putLong   = putShort - spreadWidth;
  const totalCredit = creditPerSide * 2;
  const maxProfit   = totalCredit * 100 * tranches * contracts;
  const stopPerSide = creditPerSide * 2;     // 2× credit = stop price
  const netStopLoss = (stopPerSide - creditPerSide) * 100 * tranches * contracts; // net loss if one side hits
  const doubleStop  = (stopPerSide * 2 - totalCredit) * 100 * tranches * contracts;
  const accountMin  = (spreadWidth * 100 * contracts * tranches) * 0.12;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Inputs */}
      <div>
        <div style={{ marginBottom: 16, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Configure Your MEIC
        </div>
        {[
          { label: 'SPX Spot Price', value: spxSpot, set: setSpxSpot, min: 4000, max: 7000, step: 10, fmt: (v: number) => v.toLocaleString() },
          { label: 'Spread Width (pts)', value: spreadWidth, set: setSpreadWidth, min: 10, max: 100, step: 5, fmt: (v: number) => `${v} pts` },
          { label: 'Credit / Side ($)', value: creditPerSide, set: setCreditPerSide, min: 0.5, max: 3, step: 0.05, fmt: (v: number) => `$${v.toFixed(2)}` },
          { label: 'Daily Tranches', value: tranches, set: setTranches, min: 1, max: 6, step: 1, fmt: (v: number) => v.toString() },
          { label: 'Contracts / Tranche', value: contracts, set: setContracts, min: 1, max: 20, step: 1, fmt: (v: number) => v.toString() },
        ].map(({ label, value, set, min, max, step, fmt }) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>{fmt(value)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value}
              onChange={e => set(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#6366f1' }}
            />
          </div>
        ))}

        <div style={{ marginTop: 6, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Strike Layout</div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 2 }}>
            <span style={{ color: '#ef4444' }}>Long Call: {callLong}</span> | <span style={{ color: '#ef4444' }}>Short Call: {callShort}</span><br />
            <span style={{ color: '#6366f1' }}>Spot: {spxSpot}</span><br />
            <span style={{ color: '#10b981' }}>Short Put: {putShort}</span> | <span style={{ color: '#10b981' }}>Long Put: {putLong}</span>
          </div>
        </div>
      </div>

      {/* Results */}
      <div>
        <div style={{ marginBottom: 16, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Daily P&L Scenarios
        </div>
        {[
          { label: 'Best Day (all expire worthless)', value: `+$${maxProfit.toLocaleString()}`, color: '#10b981' },
          { label: 'One side stopped out (1× net stop)', value: `-$${netStopLoss.toLocaleString()}`, color: '#f59e0b' },
          { label: 'Double stop day (both sides hit)', value: `-$${doubleStop.toLocaleString()}`, color: '#ef4444' },
          { label: 'Stop price per side', value: `$${stopPerSide.toFixed(2)} debit`, color: 'var(--text)' },
          { label: 'Min account (12% of max risk)', value: `~$${Math.round(accountMin / 1000) * 1000 > 0 ? Math.round(accountMin / 1000) * 1000 : accountMin}`, color: 'var(--text)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}

        <div style={{ marginTop: 12, padding: '12px 14px', background: '#6366f115', border: '1px solid #6366f125', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6366f1', marginBottom: 4 }}>MEIC+ Adjustment</div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
            Set stop at <strong>${(stopPerSide - 0.10).toFixed(2)}</strong> (instead of ${stopPerSide.toFixed(2)}) per side.
            Converts breakeven days into small winners — if one side stops, the other side's full credit turns
            a flat day into <strong>+${(creditPerSide - 0.10) * 100 * tranches * contracts}</strong>.
          </div>
        </div>
      </div>

      {/* P&L Diagram — full width */}
      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Iron Condor Expiry P&L (per tranche, 1 contract)
        </div>
        <IronCondorDiagram
          spxSpot={spxSpot}
          callShort={callShort}
          callLong={callLong}
          putShort={putShort}
          putLong={putLong}
          credit={totalCredit}
        />
      </div>
    </div>
  );
}

// ── Quiz component ─────────────────────────────────────────────────────────
const QUIZ_QUESTIONS = [
  {
    q: 'In MEIC, what does the stop price equal for a credit spread selling at $1.25?',
    options: ['$1.25', '$2.50 debit', '$2.25 debit', '$3.75 debit'],
    correct: 1,
    explain: 'The stop is set at 2× the initial credit. Selling $1.25 means your stop is at $2.50 debit — a net loss of $1.25, exactly equal to the premium collected.',
  },
  {
    q: 'Why does Tammy prefer SPX over SPY or QQQ for 0DTE condors?',
    options: ['Higher liquidity', 'Section 1256 tax treatment + cash settlement', 'Tighter spreads only', 'SPX has higher implied vol'],
    correct: 1,
    explain: 'SPX qualifies for 60/40 tax treatment (60% long-term gains even for same-day trades) under Section 1256 of the IRS code, and it settles in cash — no risk of early assignment or pin risk at expiration.',
  },
  {
    q: 'What is a "double stop" day?',
    options: ['Both the call spread AND put spread hit their stop losses on the same day', 'You enter two tranches back-to-back', 'You stop trading by 2 PM ET', 'Your broker stops your order twice'],
    correct: 0,
    explain: 'A double-stop day is when the market makes a large intraday swing (up then down, or vice versa) that triggers the stop on both the call spread and the put spread the same day. It\'s the worst-case outcome — equivalent to roughly 2× a regular losing day.',
  },
  {
    q: 'Why does MEIC use 5–6 tranches spread over the afternoon instead of one entry?',
    options: ['To collect more premium per day', 'To diversify entry timing — no single entry point dominates the day\'s result', 'Commission optimization', 'Regulatory position limits'],
    correct: 1,
    explain: 'The core innovation of MEIC is spreading entries across the afternoon. One bad entry at an unlucky moment is diluted by 4–5 other entries at better levels. This dramatically smooths out the equity curve compared to single-entry 0DTE strategies.',
  },
  {
    q: 'What is the typical minimum OTM distance Tammy requires for the short strikes?',
    options: ['$5 OTM', '$10 OTM', '$25 OTM', 'No minimum — delta-based only'],
    correct: 1,
    explain: 'Tammy requires the short strike to be at least $10 OTM from the current SPX spot at the time of each entry. If a $1.25 credit cannot be collected with $10+ OTM, she skips that tranche.',
  },
];

function Quiz() {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const q = QUIZ_QUESTIONS[current];

  function choose(idx: number) {
    if (selected !== null) return;
    setSelected(idx);
    if (idx === q.correct) setScore(s => s + 1);
  }

  function next() {
    if (current + 1 >= QUIZ_QUESTIONS.length) { setDone(true); return; }
    setCurrent(c => c + 1);
    setSelected(null);
  }

  if (done) {
    const pct = Math.round((score / QUIZ_QUESTIONS.length) * 100);
    return (
      <div style={{ textAlign: 'center', padding: '32px 24px' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>{pct >= 80 ? '🏆' : pct >= 60 ? '📈' : '📚'}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-h)', marginBottom: 8 }}>
          {score} / {QUIZ_QUESTIONS.length} correct ({pct}%)
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
          {pct >= 80 ? 'Excellent! You understand the MEIC framework well.' : pct >= 60 ? 'Good foundation — review the sections on stop management.' : 'Review the strategy details above before trading this.'}
        </div>
        <button onClick={() => { setCurrent(0); setSelected(null); setScore(0); setDone(false); }}
          style={{ padding: '10px 24px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          Retake Quiz
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Question {current + 1} of {QUIZ_QUESTIONS.length}
        </div>
        <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>Score: {score}/{current}</div>
      </div>
      <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 20 }}>
        <div style={{ height: 4, background: '#6366f1', borderRadius: 2, width: `${((current) / QUIZ_QUESTIONS.length) * 100}%`, transition: 'width 0.3s' }} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-h)', marginBottom: 16, lineHeight: 1.5 }}>{q.q}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {q.options.map((opt, i) => {
          let bg = 'var(--bg-card)';
          let border = '1px solid var(--border)';
          let color = 'var(--text)';
          if (selected !== null) {
            if (i === q.correct) { bg = '#10b98115'; border = '1px solid #10b98150'; color = '#10b981'; }
            else if (i === selected && i !== q.correct) { bg = '#ef444415'; border = '1px solid #ef444450'; color = '#ef4444'; }
          }
          return (
            <button key={i} onClick={() => choose(i)}
              style={{ padding: '12px 14px', background: bg, border, borderRadius: 8, textAlign: 'left', cursor: selected !== null ? 'default' : 'pointer', color, fontSize: 13, lineHeight: 1.4, transition: 'all 0.15s', fontFamily: 'inherit' }}>
              <span style={{ fontWeight: 600, marginRight: 8 }}>{String.fromCharCode(65 + i)}.</span>{opt}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: selected === q.correct ? '#10b98115' : '#f59e0b15', border: `1px solid ${selected === q.correct ? '#10b98130' : '#f59e0b30'}`, borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: selected === q.correct ? '#10b981' : '#f59e0b', marginBottom: 4 }}>
            {selected === q.correct ? 'Correct!' : 'Not quite.'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{q.explain}</div>
        </div>
      )}
      {selected !== null && (
        <button onClick={next}
          style={{ marginTop: 14, padding: '10px 24px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', float: 'right' }}>
          {current + 1 >= QUIZ_QUESTIONS.length ? 'See Results' : 'Next Question'}
        </button>
      )}
      <div style={{ clear: 'both' }} />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export function MEIC() {
  const [activeTab, setActiveTab] = useState<'overview' | 'rules' | 'results' | 'risks'>('overview');

  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'overview', label: 'Strategy Overview' },
    { id: 'rules', label: 'Entry & Exit Rules' },
    { id: 'results', label: 'Performance Data' },
    { id: 'risks', label: 'Risks & Criticism' },
  ];

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="badge-row">
        <Badge label="0 DTE" color="#6366f1" />
        <Badge label="DEFINED RISK" color="#10b981" />
        <Badge label="PREMIUM SELLING" color="#f59e0b" />
        <Badge label="SPX ONLY" color="#8b5cf6" />
      </div>
      <h1 style={{ margin: '0 0 6px', fontSize: 32, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>
        MEIC: Tammy Chambless 0DTE Iron Condor
      </h1>
      <p style={{ margin: '0 0 6px', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.7 }}>
        The <strong>Multiple Entry Iron Condor (MEIC)</strong> is a systematic same-day options income strategy developed by Tammy Chambless — widely known as the "Queen of 0DTE." Instead of timing a single perfect entry, MEIC spreads 5–6 iron condor tranches across the afternoon on SPX 0DTE options, statistically diversifying entry risk and smoothing the equity curve.
      </p>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.65 }}>
        Community-tracked data across 9,100+ trades (Apr 2021–Feb 2026) shows 49 of 57 months profitable with ~20% CAGR and ~4% max drawdown in favorable regimes — though the strategy requires automation software and carries meaningful tail risk on volatile days.
      </p>

      {/* Stat row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 32 }}>
        <StatCard label="Reported CAGR" value="~20.7%" sub="Self-reported, Jan 2023–2025" color="#10b981" />
        <StatCard label="Max Drawdown" value="~4.3%" sub="Normal market conditions" color="#6366f1" />
        <StatCard label="Win Rate / Trade" value="~40%" sub="Per individual spread" color="#f59e0b" />
        <StatCard label="Months Profitable" value="49/57" sub="Apr 2021–Feb 2026" color="#8b5cf6" />
        <StatCard label="Daily Tranches" value="5–6" sub="Every 30 min, 1–3 PM ET" color="#06b6d4" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 28, overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none', borderBottom: activeTab === t.id ? '2px solid #6366f1' : '2px solid transparent',
              color: activeTab === t.id ? '#6366f1' : 'var(--text-muted)', fontWeight: activeTab === t.id ? 600 : 400,
              fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'all 0.15s',
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Overview ── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gap: 28 }}>
          {/* Who is Tammy */}
          <div>
            <SectionHeader title="Who Is Tammy Chambless?" color="#8b5cf6" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <InfoBox title="BACKGROUND" color="#8b5cf6">
                Retired licensed architect and former principal at GFF Architects in Dallas (1984–2017). Also an accomplished sculptor and artist. After retiring, she transitioned to full-time trading.
              </InfoBox>
              <InfoBox title="TRADING EXPERIENCE" color="#6366f1">
                Has traded stocks for 30+ years and options since 2006. Focused exclusively on 0DTE strategies since 2019. First publicly presented the MEIC framework to the Online Traders Club in August 2020.
              </InfoBox>
              <InfoBox title="WHERE TO FIND HER" color="#10b981">
                YouTube: @tammychambless-0dteoptions · MEIC Course: Option Omega Academy · Community: Quantum Options Facebook Group + Discord · Podcast: Speaking Greeks (Nov 2022) · Interview: Dan Sheridan channel
              </InfoBox>
              <InfoBox title="CREDENTIALS NOTE" color="#f59e0b">
                Tammy is not a licensed financial advisor (no FINRA, CFA, or RIA registration). She presents as a transparent self-taught retail trader who shares her actual daily results publicly in the Quantum Options community.
              </InfoBox>
            </div>
          </div>

          {/* Core concept */}
          <div>
            <SectionHeader title="The Core Concept: Why Multiple Entries?" color="#6366f1" />
            <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7, marginBottom: 16 }}>
              Standard 0DTE iron condors require picking a single entry time. That creates enormous timing risk — an unlucky entry 30 minutes before a large move can wipe out an entire day. MEIC solves this by spreading 5 entries every 30 minutes, so no single moment dominates the session's outcome.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { num: '1', title: 'Diversify Time', desc: 'Entry every 30 min in the afternoon, when morning volatility has settled.' },
                { num: '2', title: 'Separate Sides', desc: 'Put spread and call spread managed independently with individual stops — not as a packaged unit.' },
                { num: '3', title: 'Automate Stops', desc: 'OCO stop orders placed immediately at 2× credit per side using Trade Automation Toolbox (TAT) or Trade Steward.' },
              ].map(({ num, title, desc }) => (
                <div key={num} style={{ padding: '16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#6366f120', marginBottom: 8 }}>{num}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-h)', marginBottom: 6 }}>{title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{desc}</div>
                </div>
              ))}
            </div>

            {/* Entry tranche win rate chart */}
            <div style={{ marginTop: 20 }}>
              <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Win Rate by Entry Tranche (illustrative, community data)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trancheData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid {...CS.grid} />
                  <XAxis dataKey="entry" {...CS.ax} />
                  <YAxis domain={[50, 70]} {...CS.ax} tickFormatter={v => `${v}%`} />
                  <Tooltip {...CS.tip} formatter={(v: number, n: string) => [n === 'winRate' ? `${v}%` : `$${v}`, n === 'winRate' ? 'Win Rate' : 'Avg Credit']} />
                  <Bar dataKey="winRate" fill="#6366f1" radius={[4, 4, 0, 0]} name="winRate" />
                </BarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                Later afternoon entries historically show slightly higher win rates as intraday trends mature.
              </p>
            </div>
          </div>

          {/* Interactive calculator */}
          <div>
            <SectionHeader title="Interactive MEIC Trade Builder" color="#10b981" />
            <div style={{ padding: 20, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <MEICCalculator />
            </div>
          </div>

          {/* Knowledge Quiz */}
          <div>
            <SectionHeader title="Test Your MEIC Knowledge" color="#8b5cf6" />
            <div style={{ padding: 24, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12 }}>
              <Quiz />
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Entry & Exit Rules ── */}
      {activeTab === 'rules' && (
        <div style={{ display: 'grid', gap: 28 }}>
          <div>
            <SectionHeader title="Entry Rules" color="#6366f1" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Underlying', value: 'SPX (S&P 500 Index)', note: 'Section 1256 tax + cash-settled — no pin risk' },
                { label: 'Expiration', value: '0 DTE (same day)', note: 'Enter and exit same session' },
                { label: 'Entry Window', value: '1:00 PM – 3:00 PM ET', note: 'After morning volatility settles' },
                { label: 'Number of Tranches', value: '5 entries, every 30 min', note: 'Previously 6; updated July 2023' },
                { label: 'Min Credit / Side', value: '$1.25 per spread', note: 'Skip tranche if credit unavailable' },
                { label: 'Min OTM Distance', value: '$10 OTM from spot', note: 'Must hold at time of entry' },
                { label: 'Spread Width', value: '50–100 points', note: 'Typical: 50 pts; max: 100 pts' },
                { label: 'Delta of Short Strike', value: '5–15 delta', note: 'Far OTM, credit-driven selection' },
              ].map(({ label, value, note }) => (
                <div key={label} style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-h)', marginBottom: 3 }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{note}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader title="Stop Loss & Exit Rules" color="#ef4444" />
            <InfoBox title="CORE RULE: 2× CREDIT STOP" color="#ef4444">
              For each side (put spread / call spread) independently: <strong>stop = 2× the initial credit collected.</strong>
              <br /><br />
              Example: If you sell the call spread for $1.50, your stop-limit order is placed at <strong>$3.00 debit</strong>.
              Your net loss if stopped = $3.00 − $1.50 = $1.50 = exactly 1× the premium received.
              <br /><br />
              Orders are placed as OCO (One Cancels the Other) combining a stop-limit and stop-market to handle fast-market conditions.
            </InfoBox>

            <InfoBox title="MEIC+ REFINEMENT" color="#f59e0b">
              Set the stop at <strong>$0.10 below the 2× level</strong> instead.
              <br /><br />
              Example: $1.25 credit → basic stop = $2.50, MEIC+ stop = $2.40.
              <br /><br />
              If one side stops at $2.40 (net loss $1.15) and the other expires worthless (gain $1.25), the net result is +$0.10 — a small winner instead of a breakeven. Converts roughly 30% of flat days into winners.
            </InfoBox>

            <InfoBox title="TAKE PROFIT" color="#10b981">
              <strong>No active profit target for the full iron condor.</strong> Positions are held to expiration (zero value) unless a stop triggers.
              <br /><br />
              Some traders in the Quantum Options community set a <strong>$0.05 GTC order</strong> to close each short leg early if it decays to near-zero, locking in virtually all premium while freeing up buying power for potential additional trades.
            </InfoBox>

            <InfoBox title="NO-TRADE DAYS" color="#8b5cf6">
              Skip MEIC entirely on: FOMC meeting days · CPI / PPI release days · Non-Farm Payroll Fridays · Major geopolitical shocks.
              <br /><br />
              Elevated implied volatility on these days widens bid-ask spreads and makes slippage at stops significantly worse. The extra premium is not worth the execution risk.
            </InfoBox>
          </div>

          <div>
            <SectionHeader title="Automation Requirements" color="#06b6d4" />
            <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7, marginBottom: 12 }}>
              Running 5 simultaneous iron condors with independently managed stops is <strong>impractical manually</strong>. Tammy uses and recommends:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { tool: 'Trade Automation Toolbox (TAT)', desc: 'Primary tool. Automates OCO stop entries, position sizing, and tranche scheduling directly through Tastyworks/tastytrade.' },
                { tool: 'Trade Steward', desc: 'Alternative automation for brokerages that don\'t support TAT. Supports conditional order logic and bracket orders.' },
                { tool: 'Tastytrade Platform', desc: 'Preferred brokerage — low commissions on SPX options ($1/contract cap) and strong OCO order infrastructure.' },
                { tool: 'Option Omega Backtester', desc: 'Used to backtest entry times monthly. Tammy re-optimizes entry times every 30 days using the prior 6 months of data.' },
              ].map(({ tool, desc }) => (
                <div key={tool} style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#06b6d4', marginBottom: 6 }}>{tool}</div>
                  <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Performance Data ── */}
      {activeTab === 'results' && (
        <div style={{ display: 'grid', gap: 28 }}>
          <div>
            <SectionHeader title="Tammy's Self-Reported Results" color="#10b981" />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Results are self-reported and posted publicly in the Quantum Options Facebook group. No independent brokerage statement audit has been published.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <StatCard label="CAGR (Jan 2023–2025)" value="~20.7%" color="#10b981" />
              <StatCard label="Max Drawdown" value="~4.31%" color="#6366f1" />
              <StatCard label="2020 Return" value="~25%" sub="Strategy refinement year" color="#f59e0b" />
            </div>
            <InfoBox title="CONTEXT" color="#6366f1">
              The 2023–2025 period was a strong upward-trending, gradually rising VIX environment — historically favorable for short-premium strategies. Performance in 2022 (VIX often 25–35+) was reported as significantly worse by community members running 2–3 tranches.
            </InfoBox>
          </div>

          <div>
            <SectionHeader title="Community-Tracked Data: 9,100+ Trades" color="#6366f1" />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              Data compiled by Theta Profits tracking breakeven iron condor (BVIC/MEIC-style) strategies from April 2021 – February 2026.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Monthly Returns (Illustrative)
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid {...CS.grid} />
                    <XAxis dataKey="month" {...CS.ax} />
                    <YAxis {...CS.ax} tickFormatter={v => `${v}%`} />
                    <Tooltip {...CS.tip} formatter={(v: number) => [`${v}%`, 'Return']} />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Bar dataKey="result" radius={[4, 4, 0, 0]}>
                      {monthlyData.map((entry, index) => (
                        <Cell key={index} fill={entry.result >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={{ marginBottom: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Double-Stop Frequency by Year (% of trading days)
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={doubleStopData}>
                    <CartesianGrid {...CS.grid} />
                    <XAxis dataKey="year" {...CS.ax} />
                    <YAxis {...CS.ax} tickFormatter={v => `${v}%`} />
                    <Tooltip {...CS.tip} formatter={(v: number) => [`${v}%`, 'Double-Stop Days']} />
                    <Bar dataKey="freq" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                { label: 'Months Profitable', value: '49/57', color: '#10b981' },
                { label: 'Win Rate / Spread', value: '~40%', color: '#f59e0b' },
                { label: 'Avg Premium Capture', value: '5.65%', color: '#6366f1' },
                { label: 'Double-Stop Rate', value: '~8.6%', color: '#ef4444' },
              ].map(({ label, value, color }) => (
                <StatCard key={label} label={label} value={value} color={color} />
              ))}
            </div>
          </div>

          <div>
            <SectionHeader title="Performance by VIX Regime" color="#f59e0b" />
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              The strategy's edge is strongly regime-dependent. Low-VIX, trending environments are ideal; crisis regimes can be catastrophic.
            </p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={regimeData} layout="vertical" margin={{ top: 4, right: 60, left: 10, bottom: 0 }}>
                <CartesianGrid {...CS.grid} />
                <XAxis type="number" {...CS.ax} />
                <YAxis type="category" dataKey="regime" {...CS.ax} width={160} />
                <Tooltip {...CS.tip} />
                <Legend />
                <Bar dataKey="avgReturn" name="Avg Monthly Return %" radius={[0, 4, 4, 0]}>
                  {regimeData.map((entry, i) => (
                    <Cell key={i} fill={entry.avgReturn >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['VIX Regime', 'Avg Monthly Return', 'Win Rate', 'Max Drawdown'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regimeData.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', color: 'var(--text)', fontWeight: 500 }}>{r.regime}</td>
                      <td style={{ padding: '10px 12px', color: r.avgReturn >= 0 ? '#10b981' : '#ef4444', fontWeight: 700 }}>{r.avgReturn > 0 ? '+' : ''}{r.avgReturn}%</td>
                      <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{r.winRate}%</td>
                      <td style={{ padding: '10px 12px', color: '#ef4444' }}>{r.drawdown}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <SectionHeader title="Comparison: MEIC vs. Other 0DTE Approaches" color="#8b5cf6" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    {['Dimension', 'MEIC', 'Single-Entry 0DTE IC', '45 DTE Iron Condor', '0DTE Iron Butterfly'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Entries / Day', '5–6', '1', '1/trade (hold weeks)', '1'],
                    ['Timing', '1–3 PM ET', 'Single window', 'Any', 'Near open/close'],
                    ['Spread Width', '50–100 pts', '10–30 pts', '20–50 pts', 'N/A (ATM)'],
                    ['Stop Rule', '2× credit/side', '2× credit', '50% or 200%', 'Varies'],
                    ['Win Rate', '~40% per spread', '60–80%', '~70%', '40–50%'],
                    ['Overnight Risk', 'None (0DTE)', 'None (0DTE)', 'Yes — gap risk', 'None (0DTE)'],
                    ['Automation Needed', 'Critical', 'Helpful', 'No', 'No'],
                    ['Account Minimum', '$30–50K', '$10K+', '$10K+', '$10K+'],
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg-card)' : 'transparent' }}>
                      {row.map((cell, j) => (
                        <td key={j} style={{ padding: '10px 12px', color: j === 1 ? '#6366f1' : 'var(--text)', fontWeight: j === 1 ? 600 : 400 }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Risks & Criticism ── */}
      {activeTab === 'risks' && (
        <div style={{ display: 'grid', gap: 28 }}>
          <div>
            <SectionHeader title="Key Risks" color="#ef4444" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                {
                  risk: 'Double Stop-Loss Tail Risk',
                  color: '#ef4444',
                  desc: 'If SPX makes a large intraday swing in one direction then reverses, both the put spread and call spread can be stopped out the same day. One double-stop day consumes multiple winning days. Frequency rose to ~11% of trading days in 2024.',
                },
                {
                  risk: 'Automation Dependency',
                  color: '#ef4444',
                  desc: 'Without TAT or Trade Steward, running 5+ independent stops simultaneously is not feasible manually. A software failure, connectivity issue, or broker outage on an active day can result in stops not executing at intended levels.',
                },
                {
                  risk: 'Slippage at Stops',
                  color: '#f59e0b',
                  desc: '50-point wide SPX spreads can have meaningful bid-ask spreads, especially during volatile intraday moves. Early backtests did not fully account for slippage — real-world execution costs shrink the edge, particularly on stop-out days.',
                },
                {
                  risk: 'Market Regime Dependency',
                  color: '#f59e0b',
                  desc: 'MEIC thrives in low-VIX, range-bound or slowly-trending markets. The 2022 bear market (VIX >25 for most of the year) was reported as significantly unprofitable. The strategy has not been stress-tested through a 2008-style event.',
                },
                {
                  risk: 'Extreme Gamma at Close',
                  color: '#f59e0b',
                  desc: '0DTE options experience exponentially accelerating gamma in the final hour. A position that is $5 OTM with 1 hour left can become a max loss with a 10-point SPX move. Late-day momentum events are particularly dangerous.',
                },
                {
                  risk: 'Monthly Overfitting',
                  color: '#8b5cf6',
                  desc: 'Tammy re-optimizes entry times monthly using the prior 6 months of data. Critics argue this risks overfitting to recent market micro-structure that may not persist — a well-documented failure mode in systematic strategy development.',
                },
                {
                  risk: 'Unverified Return Claims',
                  color: '#8b5cf6',
                  desc: 'The 20.7% CAGR is self-reported without independent audit. The measurement period (2023–2025) coincides with one of the strongest bull markets in history — favorable conditions for all short-premium strategies.',
                },
                {
                  risk: 'Psychological Difficulty',
                  color: '#06b6d4',
                  desc: 'With a ~40% win rate per individual spread, many traders experience extended losing runs even during profitable periods. The strategy is mathematically sound but psychologically difficult — traders frequently abandon it during normal drawdown periods.',
                },
              ].map(({ risk, color, desc }) => (
                <div key={risk} style={{ padding: '14px 16px', background: `${color}08`, border: `1px solid ${color}25`, borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 6 }}>{risk}</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader title="Community Reviews: What Traders Say" color="#6366f1" />
            <div style={{ display: 'grid', gap: 12 }}>
              {[
                {
                  source: 'YouTube Comments',
                  sentiment: 'positive',
                  quote: '"Tammy is the most transparent 0DTE educator I\'ve found. She posts her actual daily P&L publicly — not a highlight reel. The strategy is real, not a course-selling scheme."',
                },
                {
                  source: 'Option Alpha Community',
                  sentiment: 'positive',
                  quote: '"The multi-entry approach genuinely smooths the equity curve. After adapting MEIC with a rolling call spread adjustment, my drawdowns dropped significantly compared to single-entry approaches."',
                },
                {
                  source: 'Reddit r/thetagang',
                  sentiment: 'mixed',
                  quote: '"The math works and the community data is compelling, but it requires $30K+ and automation software to run properly. For smaller accounts it\'s just not practical."',
                },
                {
                  source: 'Theta Profits Blog',
                  sentiment: 'positive',
                  quote: '"9,100 trades over 4 years: 49 of 57 months were profitable. The individual trade win rate is low (~40%) but average win is more than double average loss. The edge is real — the question is execution."',
                },
                {
                  source: 'Critical Review',
                  sentiment: 'negative',
                  quote: '"The 2024 data is concerning — double-stop days jumped to 11%+. One December 2025 flash crash caused massive slippage on MEIC-style strategies. In normal conditions it works; in tail events, the defined-risk structure doesn\'t protect you from slippage."',
                },
              ].map(({ source, sentiment, quote }) => (
                <div key={source} style={{ padding: '14px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${sentiment === 'positive' ? '#10b981' : sentiment === 'negative' ? '#ef4444' : '#f59e0b'}`, borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{source}</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', background: sentiment === 'positive' ? '#10b98115' : sentiment === 'negative' ? '#ef444415' : '#f59e0b15', color: sentiment === 'positive' ? '#10b981' : sentiment === 'negative' ? '#ef4444' : '#f59e0b', borderRadius: 4, fontWeight: 600 }}>
                      {sentiment}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, fontStyle: 'italic' }}>{quote}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader title="Is MEIC Right for You?" color="#10b981" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ padding: '18px', background: '#10b98108', border: '1px solid #10b98125', borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', marginBottom: 10 }}>MEIC may suit you if...</div>
                {[
                  'Account $30K–$50K+ available for SPX margin',
                  'Comfortable with ~40% per-spread win rate',
                  'Can set up and maintain automation software',
                  'Have time to monitor during 1–3 PM ET trading window',
                  'Prefer defined-risk over undefined-risk structures',
                  'Understand 0DTE gamma behavior and expiration dynamics',
                  'Can skip trading on high-impact news days',
                ].map(s => (
                  <div key={s} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 13, color: 'var(--text)' }}>
                    <span style={{ color: '#10b981', flexShrink: 0 }}>✓</span>
                    {s}
                  </div>
                ))}
              </div>
              <div style={{ padding: '18px', background: '#ef444408', border: '1px solid #ef444425', borderRadius: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', marginBottom: 10 }}>MEIC may not suit you if...</div>
                {[
                  'Account under $15,000',
                  'No experience with options Greeks or spread mechanics',
                  'Cannot tolerate watching multiple losing trades in sequence',
                  'No access to or budget for automation tools',
                  'Trading around a full-time job during market hours',
                  'Expecting a >70% per-trade win rate',
                  'Have not paper-traded any 0DTE strategy previously',
                ].map(s => (
                  <div key={s} style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: 13, color: 'var(--text)' }}>
                    <span style={{ color: '#ef4444', flexShrink: 0 }}>✗</span>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="Sources & Further Research" color="#8b5cf6" />
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { label: 'Tammy Chambless YouTube', desc: 'Daily trade recaps and strategy walkthroughs — @tammychambless-0dteoptions' },
                { label: 'Option Omega MEIC Course', desc: 'academy.optionomega.com/course/meic — 14+ hours of definitive course content' },
                { label: 'Theta Profits: 9,100 Trades Analysis', desc: 'thetaprofits.com — community-compiled performance data 2021–2026' },
                { label: 'MEIC Strategy PDF (Jan 2023)', desc: 'Scribd — original strategy document from January 16, 2023 presentation' },
                { label: 'MEIC+ Update PDF (Jul 2023)', desc: 'Scribd — July 22, 2023 MEIC+ refinement with stop adjustment methodology' },
                { label: 'Speaking Greeks Podcast', desc: 'November 2022 interview (~76 min) — deep dive into Tammy\'s philosophy and rules' },
                { label: 'CBOE: Henry Schwartz 0DTE Iron Condor', desc: 'cboe.com — institutional analysis of SPX 0DTE iron condor strategies' },
                { label: 'Quantum Options Community', desc: 'Facebook Group + Discord — Tammy posts daily results; invite via tamchambless@gmail.com' },
              ].map(({ label, desc }) => (
                <div key={label} style={{ padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#8b5cf6', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 40, padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>Educational disclaimer:</strong> This page summarizes publicly available information about Tammy Chambless's MEIC strategy for educational purposes. Performance data is community-reported and not independently audited. 0DTE options carry substantial risk including the potential loss of the entire premium and, in fast markets, losses exceeding stop-loss targets due to slippage. This is not financial advice.
      </div>
    </div>
  );
}
