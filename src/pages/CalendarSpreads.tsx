import { useState, useMemo } from 'react';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { blackScholes } from '../lib/blackScholes';

// ── Shared styles ──────────────────────────────────────────────────────────

const card = (style?: React.CSSProperties): React.CSSProperties => ({
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '20px 24px',
  ...style,
});

const CHART = {
  tooltip: {
    contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-h)' },
  },
  grid: { strokeDasharray: '3 3', stroke: 'var(--border)' },
  xAxis: { tick: { fill: 'var(--text-muted)', fontSize: 11 }, tickLine: false, axisLine: { stroke: 'var(--border)' } },
  yAxis: { tick: { fill: 'var(--text-muted)', fontSize: 11 }, tickLine: false, axisLine: false },
};

function SectionHeader({ title, color = '#6366f1' }: { title: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, marginTop: 40 }}>
      <div style={{ width: 4, height: 22, borderRadius: 2, background: color }} />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--text-h)' }}>{title}</h2>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: color + '18', border: `1px solid ${color}50`, color,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 10px', borderRadius: 20,
    }}>{label}</span>
  );
}

function RiskCard({ title, body, severity }: { title: string; body: string; severity: 'warn' | 'info' | 'critical' }) {
  const cfg = {
    warn:     { bg: '#f59e0b10', border: '#f59e0b40', dot: '#f59e0b', title: '#fcd34d' },
    info:     { bg: '#6366f110', border: '#6366f140', dot: '#818cf8', title: '#a5b4fc' },
    critical: { bg: '#ef444410', border: '#ef444440', dot: '#ef4444', title: '#fca5a5' },
  }[severity];
  return (
    <div style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
        <div style={{ color: cfg.title, fontWeight: 700, fontSize: 13 }}>{title}</div>
      </div>
      <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ color: 'var(--text)', fontSize: 13 }}>{label}</span>
        <span style={{ color: '#818cf8', fontWeight: 700 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#6366f1' }} />
    </div>
  );
}

// ── Payoff math ────────────────────────────────────────────────────────────
// All three structures are valued at the FRONT expiration: short front-month
// legs expire to intrinsic value; long back-month legs still carry time value
// priced with Black-Scholes.

interface DemoLeg {
  kind: 'call' | 'put';
  side: 1 | -1;          // 1 = long, -1 = short
  strike: number;
  dte: number;           // calendar days at entry
}

const SPOT = 100;
const RATE = 0.04;
const FRONT_DTE = 30;
const BACK_DTE = 60;

const STRATS: { key: string; name: string; color: string; legs: DemoLeg[] }[] = [
  {
    key: 'cal', name: 'Calendar Spread', color: '#6366f1',
    legs: [
      { kind: 'call', side: -1, strike: 100, dte: FRONT_DTE },
      { kind: 'call', side: 1,  strike: 100, dte: BACK_DTE },
    ],
  },
  {
    key: 'dcal', name: 'Double Calendar', color: '#10b981',
    legs: [
      { kind: 'put',  side: -1, strike: 95,  dte: FRONT_DTE },
      { kind: 'put',  side: 1,  strike: 95,  dte: BACK_DTE },
      { kind: 'call', side: -1, strike: 105, dte: FRONT_DTE },
      { kind: 'call', side: 1,  strike: 105, dte: BACK_DTE },
    ],
  },
  {
    key: 'ddiag', name: 'Double Diagonal', color: '#f59e0b',
    legs: [
      { kind: 'put',  side: -1, strike: 95,  dte: FRONT_DTE },
      { kind: 'put',  side: 1,  strike: 90,  dte: BACK_DTE },
      { kind: 'call', side: -1, strike: 105, dte: FRONT_DTE },
      { kind: 'call', side: 1,  strike: 110, dte: BACK_DTE },
    ],
  },
];

function legPrice(leg: DemoLeg, S: number, T: number, sigma: number): number {
  if (T <= 0) {
    return leg.kind === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  }
  const bs = blackScholes({ S, K: leg.strike, T, r: RATE, sigma });
  return leg.kind === 'call' ? bs.call : bs.put;
}

function entryCost(legs: DemoLeg[], ivEntry: number): number {
  return legs.reduce((sum, leg) => sum + leg.side * legPrice(leg, SPOT, leg.dte / 365, ivEntry), 0);
}

// P/L per contract (×100) at front expiration for a given underlying price
function pnlAtFrontExpiry(legs: DemoLeg[], price: number, ivEntry: number, ivExit: number, cost: number): number {
  const value = legs.reduce((sum, leg) => {
    const remaining = (leg.dte - FRONT_DTE) / 365;
    return sum + leg.side * legPrice(leg, price, remaining, ivExit);
  }, 0);
  void ivEntry;
  return (value - cost) * 100;
}

// ── Static content ─────────────────────────────────────────────────────────

interface StratInfo {
  key: string;
  name: string;
  color: string;
  tagline: string;
  structure: { action: string; leg: string }[];
  mechanics: string;
  bestWhen: string[];
  watchOut: string;
}

const STRAT_INFO: StratInfo[] = [
  {
    key: 'cal',
    name: '1 · Calendar Spread (Horizontal Spread)',
    color: '#6366f1',
    tagline: 'Sell near-term time decay, own longer-term optionality — at a single strike.',
    structure: [
      { action: 'SELL', leg: '30-day call (or put), strike $100' },
      { action: 'BUY',  leg: '60-day call (or put), same strike $100' },
    ],
    mechanics: 'Both legs share the same strike and type — only the expiration differs. The short front-month option decays faster (higher theta) than the long back-month option, so if the stock sits near the strike, the spread widens in your favor. Maximum profit occurs when the stock pins exactly at the strike on front-month expiration: the short option expires worthless while the long option retains the most time value. The position is long vega — rising implied volatility inflates the back-month leg more than the front.',
    bestWhen: [
      'You expect the stock to stay near a specific price (pin) through front expiration',
      'Implied volatility is low and you expect it to rise (long vega)',
      'You want defined risk — max loss is the small net debit paid',
      'Term structure is flat or front IV is elevated vs back (e.g. pre-earnings in front month)',
    ],
    watchOut: 'Profit zone is narrow. A large move in either direction loses money, and an IV crush hits the long back-month leg.',
  },
  {
    key: 'dcal',
    name: '2 · Double Calendar Spread',
    color: '#10b981',
    tagline: 'Two calendars — a put calendar below and a call calendar above — creating a wide profit plateau.',
    structure: [
      { action: 'SELL', leg: '30-day put, strike $95' },
      { action: 'BUY',  leg: '60-day put, strike $95' },
      { action: 'SELL', leg: '30-day call, strike $105' },
      { action: 'BUY',  leg: '60-day call, strike $105' },
    ],
    mechanics: 'Instead of betting on a single pin price, you place one calendar below the market and one above it. The payoff curve develops two peaks (one at each strike) with a saddle in the middle — the net effect is a wide, tent-shaped profit zone covering the whole expected range. Like the single calendar it is a net debit trade, long vega, and profits primarily from the theta differential between months. It is the time-spread cousin of an iron condor: you win if the stock stays inside the strikes, but you also win if IV rises.',
    bestWhen: [
      'You expect the stock to stay in a range but are not confident about a specific pin',
      'IV is low/mid and you want positive vega alongside positive theta',
      'Around events where front-month IV is pumped relative to back-month',
      'You want a wider breakeven zone than a single calendar offers',
    ],
    watchOut: 'Twice the legs means twice the commissions and slippage. The middle saddle can dip low if strikes are placed too far apart.',
  },
  {
    key: 'ddiag',
    name: '3 · Double Diagonal Spread',
    color: '#f59e0b',
    tagline: 'A double calendar whose long legs are moved further out-of-the-money — cheaper, wider, more theta.',
    structure: [
      { action: 'SELL', leg: '30-day put, strike $95' },
      { action: 'BUY',  leg: '60-day put, strike $90 (further OTM)' },
      { action: 'SELL', leg: '30-day call, strike $105' },
      { action: 'BUY',  leg: '60-day call, strike $110 (further OTM)' },
    ],
    mechanics: 'Each side is a diagonal: different strike AND different expiration. Moving the long back-month legs further OTM makes them cheaper, which reduces the net debit (sometimes even producing a credit) and embeds a short vertical spread inside each wing. The result is a flatter, wider profit plateau that behaves like an iron condor early on, but keeps the long-vega, long-back-month character of a calendar. Risk is defined by the strike width between the short and long legs on each side, plus/minus the net debit or credit.',
    bestWhen: [
      'You want condor-like range income but with positive vega instead of negative',
      'IV is moderate and you want protection if it spikes',
      'You want a wider profit zone and more theta than a double calendar',
      'You are willing to actively manage two diagonals into front expiration',
    ],
    watchOut: 'The embedded short verticals mean max loss is wider than a double calendar (strike width matters). Assignment risk on short legs as front expiration nears.',
  },
];

const COMPARISON_ROWS = [
  ['Legs', '2 (same strike, 2 expirations)', '4 (2 strikes, 2 expirations)', '4 (4 strikes, 2 expirations)'],
  ['Typical cost', 'Small net debit', 'Net debit (≈ 2 calendars)', 'Smaller debit — sometimes a credit'],
  ['Profit zone', 'Narrow tent around one strike', 'Wide plateau between two strikes', 'Widest plateau, flatter top'],
  ['Max risk', 'Net debit paid', 'Net debit paid', 'Wing width ± net debit/credit'],
  ['Vega', 'Long (most concentrated)', 'Long', 'Long (mildest of the three)'],
  ['Theta', 'Positive near strike', 'Positive inside the range', 'Highest positive theta'],
  ['Ideal forecast', 'Pin at one price, IV rising', 'Range-bound, IV rising', 'Range-bound, want condor-like income'],
  ['Closest cousin', 'ATM butterfly (but long vega)', 'Iron condor (but long vega)', 'Iron condor with vega protection'],
];

// ── Main page ──────────────────────────────────────────────────────────────

export function CalendarSpreads() {
  const [ivEntry, setIvEntry] = useState(25);   // IV at entry, %
  const [ivExit, setIvExit] = useState(25);     // IV at front expiration, %
  const [visible, setVisible] = useState<Record<string, boolean>>({ cal: true, dcal: true, ddiag: true });

  const chartData = useMemo(() => {
    const costs = STRATS.map(s => entryCost(s.legs, ivEntry / 100));
    const lo = SPOT * 0.82;
    const hi = SPOT * 1.18;
    const steps = 120;
    const rows = [];
    for (let i = 0; i <= steps; i++) {
      const price = lo + (hi - lo) * (i / steps);
      const row: Record<string, number> = { price: +price.toFixed(1) };
      STRATS.forEach((s, si) => {
        row[s.key] = +pnlAtFrontExpiry(s.legs, price, ivEntry / 100, ivExit / 100, costs[si]).toFixed(1);
      });
      rows.push(row);
    }
    return rows;
  }, [ivEntry, ivExit]);

  const debits = useMemo(
    () => STRATS.map(s => entryCost(s.legs, ivEntry / 100) * 100),
    [ivEntry],
  );

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="badge-row">
        <Badge label="TIME SPREADS" color="#6366f1" />
        <Badge label="DEFINED RISK" color="#10b981" />
        <Badge label="LONG VEGA" color="#8b5cf6" />
        <Badge label="THETA POSITIVE" color="#f59e0b" />
      </div>
      <h1 style={{ margin: '0 0 6px', fontSize: 32, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>
        Calendar, Double Calendar &amp; Double Diagonal Spreads
      </h1>
      <p style={{ margin: '0 0 6px', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.7 }}>
        These three strategies form the <strong>time-spread family</strong>: instead of betting purely on price direction,
        they harvest the fact that near-term options decay faster than longer-term options. You sell expensive,
        fast-decaying front-month premium and own slower-decaying back-month options against it.
      </p>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.65 }}>
        All three are net-long-vega, theta-positive, defined-risk structures. They differ in how wide the profit zone is,
        how much they cost, and how much active management they demand.
      </p>

      {/* Interactive comparison chart */}
      <SectionHeader title="Interactive Payoff Comparison (at front-month expiration)" />
      <div style={card()}>
        <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Underlying at <strong style={{ color: 'var(--text-h)' }}>$100</strong> · front month 30 DTE, back month 60 DTE ·
          shorts expire to intrinsic value, longs re-priced with Black-Scholes (30 days remaining).
          Drag the IV sliders to see the family's signature <strong style={{ color: '#a5b4fc' }}>long-vega</strong> behavior —
          raise IV at exit and every curve lifts; crush it and the tents deflate.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 12 }}>
          <Slider label="IV at entry" value={ivEntry} min={10} max={60} step={1} onChange={setIvEntry} fmt={v => `${v}%`} />
          <Slider label="IV at front expiration" value={ivExit} min={10} max={60} step={1} onChange={setIvExit} fmt={v => `${v}%`} />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {STRATS.map((s, i) => (
            <button key={s.key}
              onClick={() => setVisible(v => ({ ...v, [s.key]: !v[s.key] }))}
              style={{
                background: visible[s.key] ? s.color + '20' : 'transparent',
                border: `1px solid ${visible[s.key] ? s.color : 'var(--border)'}`,
                color: visible[s.key] ? s.color : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
              }}>
              {s.name} · {debits[i] >= 0 ? 'debit' : 'credit'} ${Math.abs(debits[i]).toFixed(0)}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -6 }}>
            <CartesianGrid {...CHART.grid} />
            <XAxis dataKey="price" {...CHART.xAxis} tickFormatter={v => `$${v}`} interval={19} />
            <YAxis {...CHART.yAxis} tickFormatter={v => `$${v}`} />
            <Tooltip {...CHART.tooltip}
              formatter={(value, name) => {
                const v = typeof value === 'number' ? value : 0;
                const strat = STRATS.find(s => s.key === name);
                return [
                  <span style={{ color: v >= 0 ? '#10b981' : '#ef4444' }}>{v >= 0 ? '+' : ''}${v.toFixed(0)}</span>,
                  strat?.name ?? String(name),
                ];
              }}
              labelFormatter={l => `Stock price: $${l}`} />
            <Legend formatter={(value: string) => STRATS.find(s => s.key === value)?.name ?? value} wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#3b4060" strokeWidth={1.5} />
            <ReferenceLine x={SPOT} stroke="#8896aa" strokeWidth={1} strokeDasharray="4 4"
              label={{ value: 'spot', fill: 'var(--text-muted)', fontSize: 10, position: 'top' }} />
            {STRATS.filter(s => visible[s.key]).map(s => (
              <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>💡 Notice: the single calendar peaks highest but narrowest; the double calendar trades peak height for width; the double diagonal is flattest and widest.</span>
        </div>
      </div>

      {/* Individual strategy sections */}
      {STRAT_INFO.map(info => (
        <div key={info.key}>
          <SectionHeader title={info.name} color={info.color} />
          <div style={card()}>
            <p style={{ margin: '0 0 16px', color: info.color, fontSize: 14, fontWeight: 600 }}>{info.tagline}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>STRUCTURE (EXAMPLE, STOCK AT $100)</div>
                {info.structure.map((s, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6,
                  }}>
                    <span style={{
                      color: s.action === 'BUY' ? '#10b981' : '#ef4444',
                      fontWeight: 700, fontSize: 11, width: 36, flexShrink: 0,
                    }}>{s.action}</span>
                    <span style={{ color: 'var(--text)', fontSize: 13 }}>{s.leg}</span>
                  </div>
                ))}
                <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', margin: '16px 0 8px' }}>BEST USED WHEN</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 13, lineHeight: 1.8 }}>
                  {info.bestWhen.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>HOW IT WORKS</div>
                <p style={{ margin: '0 0 14px', color: 'var(--text)', fontSize: 13, lineHeight: 1.7 }}>{info.mechanics}</p>
                <RiskCard title="Watch out" body={info.watchOut} severity="warn" />
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Comparison table */}
      <SectionHeader title="Side-by-Side Comparison" color="#8b5cf6" />
      <div style={card({ padding: 0, overflowX: 'auto' })}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}></th>
              {STRATS.map(s => (
                <th key={s.key} style={{ textAlign: 'left', padding: '12px 16px', color: s.color, fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border)' }}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map(([label, ...cells], ri) => (
              <tr key={ri}>
                <td style={{ padding: '10px 16px', color: 'var(--text-h)', fontWeight: 600, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{label}</td>
                {cells.map((c, ci) => (
                  <td key={ci} style={{ padding: '10px 16px', color: 'var(--text)', borderBottom: '1px solid var(--border)', lineHeight: 1.5 }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Decision guide */}
      <SectionHeader title="Which One Should You Use?" color="#10b981" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <RiskCard severity="info" title="Strong pin thesis → Calendar"
          body="If you believe the stock will gravitate to a specific price (max-pain level, big round number, post-event drift target), the single calendar concentrates your capital exactly there and gives the highest return on risk when you're right." />
        <RiskCard severity="info" title="Range thesis, uncertain center → Double Calendar"
          body="When you expect the stock to stay between support and resistance but can't call the pin, splitting into two calendars at the range edges builds a plateau over the whole zone while keeping the long-vega benefit." />
        <RiskCard severity="info" title="Want condor income + vol protection → Double Diagonal"
          body="If you would normally sell an iron condor but IV is low enough that a volatility spike scares you, the double diagonal delivers similar range income with positive vega — a vol spike helps rather than hurts." />
      </div>

      {/* Risks */}
      <SectionHeader title="Family-Wide Risks" color="#ef4444" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <RiskCard severity="critical" title="Volatility crush"
          body="All three are long vega. A sharp IV collapse (e.g. after an event you positioned through) deflates the back-month legs and can turn a winning price forecast into a losing trade." />
        <RiskCard severity="critical" title="Big gap moves"
          body="A gap far outside the strikes pushes both months toward intrinsic value, collapsing the time-value differential you paid for. Max loss is defined, but it arrives fast." />
        <RiskCard severity="warn" title="Early assignment"
          body="Short front-month options that go in-the-money can be assigned early (especially calls before ex-dividend dates and deep ITM puts). Close or roll short legs before they become exercise candidates." />
        <RiskCard severity="warn" title="Execution & liquidity"
          body="These are 2–4 leg spreads across two expirations. Wide bid/ask spreads in the back month can eat a large share of the edge — use limit orders on the whole spread and prefer liquid underlyings." />
      </div>

      <p style={{ margin: '36px 0 8px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
        Educational content only — not investment advice. Model values use Black-Scholes with simplified assumptions
        (constant IV across strikes, 4% rate, no dividends, European exercise).
      </p>
    </div>
  );
}
