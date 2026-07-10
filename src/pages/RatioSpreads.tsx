import { useState, useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { blackScholes } from '../lib/blackScholes';

/* ── Model constants ─────────────────────────────────────────────────────────
 * SPX-like underlying at 6000, flat 20% IV, 4% rate. Strikes are picked by
 * delta (the way these trades are quoted in practice) and rounded to 5s.
 * Flat IV means no skew — noted where skew matters (it usually pays for these
 * trades in real chains).
 */

const S0 = 6000;
const IV0 = 20;      // entry IV, %
const RATE = 0.04;
const MULT = 100;

// Acklam approximation of the inverse normal CDF
function normInv(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// Strike whose |delta| matches the target, under flat IV
function deltaToStrike(delta: number, T: number, kind: 'call' | 'put'): number {
  const sigma = IV0 / 100;
  const d1 = kind === 'put' ? normInv(1 - delta) : normInv(delta);
  const K = S0 * Math.exp((RATE + (sigma * sigma) / 2) * T - d1 * sigma * Math.sqrt(T));
  return Math.round(K / 5) * 5;
}

function legValue(kind: 'call' | 'put', S: number, K: number, T: number, ivPct: number): number {
  if (T <= 0) return kind === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const bs = blackScholes({ S, K, T, r: RATE, sigma: Math.max(0.01, ivPct / 100) });
  return kind === 'call' ? bs.call : bs.put;
}

/* ── Structure catalog ──────────────────────────────────────────────────── */

interface RLeg { kind: 'call' | 'put'; side: 1 | -1; qty: number; delta: number; strike: number }

interface RStrat {
  id: string;
  name: string;
  ratio: string;            // e.g. "1 × 2"
  color: string;
  dte: number;
  gridLo: number;           // chart range as fraction of spot
  gridHi: number;
  legs: RLeg[];
  tailRisk: 'down' | 'up' | null;  // side with naked exposure
  summary: string;
  why: string;
  timeVol: string;
  management: string;
  risks: string[];
  sisters: string;
}

function mkLegs(dte: number, specs: { kind: 'call' | 'put'; side: 1 | -1; qty: number; delta: number }[]): RLeg[] {
  const T = dte / 365;
  return specs.map(s => ({ ...s, strike: deltaToStrike(s.delta, T, s.kind) }));
}

const STRATS: RStrat[] = [
  {
    id: 'putRatio', name: 'Put Front Ratio', ratio: '1 × 2', color: '#10b981', dte: 45,
    gridLo: 0.80, gridHi: 1.10, tailRisk: 'down',
    legs: mkLegs(45, [
      { kind: 'put', side: 1, qty: 1, delta: 0.30 },
      { kind: 'put', side: -1, qty: 2, delta: 0.16 },
    ]),
    summary: 'Buy one put near the money, sell two further out — usually for zero cost or a credit. You own a put spread that someone else paid for, with a profit tent peaking at the short strike.',
    why: 'The two short puts finance the long one. On indexes, put skew makes far-OTM puts trade rich, so real chains often pay you more than this flat-IV model shows. If the market sits still or drifts down toward the shorts, the long put gains intrinsic value while the shorts decay. Done for a credit, there is zero upside risk: if the market rallies, everything expires worthless and you keep the credit.',
    timeVol: 'Positive theta (you are net short a put) and short vega near the money. Time passing pulls the T+n curve up toward the expiry tent. A volatility spike hurts twice: the two shorts gain value faster than the long, and a spike usually arrives with the sell-off that pushes price toward your naked exposure. Drag the IV slider up and watch the current-value line sink below zero even with price unchanged.',
    management: 'Take profits when the tent value is captured (50–75% of max). If price approaches the short strike late, roll the shorts down/out or close. Never let a 1×2 ride into a fast sell-off — the second short put is naked.',
    risks: [
      'Below the shorts the position turns into one naked put — losses accelerate all the way down',
      'Vol expansion inflates the naked short before price even gets there',
      'Assignment risk on the shorts if they go ITM near expiration',
    ],
    sisters: 'The 1-1-2 is this trade plus a second short put financed by widening the debit spread; the PL5 flips the tail exposure by buying far-OTM puts instead of staying naked.',
  },
  {
    id: 'callRatio', name: 'Call Front Ratio', ratio: '1 × 2', color: '#10b981', dte: 45,
    gridLo: 0.90, gridHi: 1.20, tailRisk: 'up',
    legs: mkLegs(45, [
      { kind: 'call', side: 1, qty: 1, delta: 0.40 },
      { kind: 'call', side: -1, qty: 2, delta: 0.20 },
    ]),
    summary: 'Buy one call, sell two higher calls — a cheap or free bet on a modest drift higher, with the tent peaking at the short strike and naked exposure above it.',
    why: 'Same financing logic as the put ratio, pointed up. You profit on a grind toward the short strike: the long call gains intrinsic while the two shorts decay. On single stocks with call-skew (meme names, takeover candidates) the shorts can be rich; on indexes call IV is usually cheap, so the trade collects less than its put twin.',
    timeVol: 'Positive theta, short vega. Time is your friend anywhere below the short strike. The danger is the melt-up: a fast rally through the shorts turns the position into a naked call with unlimited loss — and rallies in low-vol regimes can be relentless. IV crush helps; IV expansion on a breakout hurts.',
    management: 'Close or roll the extra short call if price reaches the long strike quickly. Take the tent profit at 50–75%. Avoid earnings and known catalysts — gaps are this trade\'s enemy.',
    risks: [
      'Unlimited loss above the upper breakeven — a gap or melt-up cannot be managed in time',
      'Short squeeze / buyout risk on single names',
      'Early assignment on ITM short calls before dividends',
    ],
    sisters: 'The call backspread is its mirror image (sell 1, buy 2) for melt-up convexity instead of melt-up risk.',
  },
  {
    id: 'putBack', name: 'Put Backspread', ratio: '1 × 2 (reverse)', color: '#8b5cf6', dte: 45,
    gridLo: 0.75, gridHi: 1.10, tailRisk: null,
    legs: mkLegs(45, [
      { kind: 'put', side: -1, qty: 1, delta: 0.30 },
      { kind: 'put', side: 1, qty: 2, delta: 0.16 },
    ]),
    summary: 'Sell one put near the money, buy two further out — cheap crash insurance that explodes in value on a large decline and roughly breaks even on a rally.',
    why: 'The single short put pays for two long tails. Net long one put below the long strike means a crash makes you increasingly long protection exactly when it pays most. The trade-off is the valley: a mild decline that stops at the long strikes at expiry is maximum pain — the short put is ITM while your longs die worthless.',
    timeVol: 'Negative theta and long vega — the exact opposite of the front ratio. Every quiet day costs money; the position wants the move now. A vol spike lifts the whole current-value line (drag IV up and watch it float) because you own more options than you sold. This is the classic "long the wings" profile: it profits from chaos.',
    management: 'Time-stop it: if the move has not arrived by half the duration, close and redeploy. Never hold to expiry hoping — the valley deepens as theta burns the tails.',
    risks: [
      'Maximum loss lands on a slow drift to the long strikes at expiry — the most common market path',
      'Theta bleed compounds weekly; timing matters as much as direction',
      'IV crush after a feared event deflates the tails even if price fell',
    ],
    sisters: 'The PL5 embeds this same "long the tails" idea inside an income structure — backspread convexity without paying full theta rent.',
  },
  {
    id: 'callBack', name: 'Call Backspread', ratio: '1 × 2 (reverse)', color: '#8b5cf6', dte: 45,
    gridLo: 0.90, gridHi: 1.25, tailRisk: null,
    legs: mkLegs(45, [
      { kind: 'call', side: -1, qty: 1, delta: 0.40 },
      { kind: 'call', side: 1, qty: 2, delta: 0.20 },
    ]),
    summary: 'Sell one call, buy two higher calls — melt-up convexity for little or no cost, flat-to-positive if the market tanks instead.',
    why: 'One rich near-the-money short call funds two cheaper OTM longs. Above the long strikes you are net long one call with unlimited upside; below the short strike everything dies and you keep (or lose) roughly the small entry credit/debit. It monetizes explosive rallies — right-tail events that most income books are short.',
    timeVol: 'Negative theta, long vega. The valley between the strikes at expiry is max pain. Volatility expansion helps everywhere; on indexes, though, rallies usually crush IV — which is why call backspreads work better on single names and commodities than on SPX.',
    management: 'Same as the put backspread: time-stop at half duration, take convexity profits on the spike rather than round-tripping them.',
    risks: [
      'Max loss on a drift that pins the long strikes at expiry',
      'On indexes, IV usually falls as price rises — the vega tailwind reverses',
      'Persistent negative carry if used as a permanent position',
    ],
    sisters: 'Mirror of the put backspread; the ratio\'d cousin of a simple bull call spread with the risk/reward inverted.',
  },
  {
    id: 't112', name: 'The 1-1-2 (Tom King "112")', ratio: '1-1-2', color: '#f59e0b', dte: 120,
    gridLo: 0.70, gridHi: 1.10, tailRisk: 'down',
    legs: mkLegs(120, [
      { kind: 'put', side: 1, qty: 1, delta: 0.25 },
      { kind: 'put', side: -1, qty: 1, delta: 0.20 },
      { kind: 'put', side: -1, qty: 2, delta: 0.05 },
    ]),
    summary: 'A put debit spread (buy ~25Δ, sell ~20Δ) financed by two far-OTM short puts (~5Δ), ~120 DTE, for a net credit. Popularized by Tom King and the Trade Busters community.',
    why: 'The two 5-delta shorts collect enough to pay for the debit spread and leave a credit. In the huge middle of outcomes (market up, flat, or mildly down) everything expires and you keep the credit — the debit spread even adds profit on a controlled dip. The long duration means the naked puts sit far below the market with months of cushion, and put skew makes them rich relative to their model value.',
    timeVol: 'Positive theta throughout; short vega concentrated in the naked tails. The T+n line rises steadily in quiet markets. The failure mode is the same as every short-tail trade: a fast crash spikes vol, the 5Δ puts go 10× before price even reaches them, and margin expands exactly when you least want it. Drag IV +10 and 60 days forward to see both effects fight.',
    management: 'Standard community rules: take the naked puts off at ~50% profit or by 21 DTE, whichever first; keep the debit spread as a lottery ticket. Roll untested sides down. Size so a 2008-style move is survivable — the credit is small relative to tail exposure.',
    risks: [
      'Naked short puts: crash losses are effectively unbounded until zero',
      'Vega + margin expansion arrive together in a sell-off',
      'Backtests over calm regimes flatter the strategy — the tail has simply not been hit recently',
    ],
    sisters: 'The 1-1-2-2 adds two long tail puts to define the risk. The PL5 goes further and turns the tail into a profit engine.',
  },
  {
    id: 't1122', name: 'The 1-1-2-2 (defined-risk 112)', ratio: '1-1-2-2', color: '#f59e0b', dte: 120,
    gridLo: 0.70, gridHi: 1.10, tailRisk: null,
    legs: mkLegs(120, [
      { kind: 'put', side: 1, qty: 1, delta: 0.25 },
      { kind: 'put', side: -1, qty: 1, delta: 0.20 },
      { kind: 'put', side: -1, qty: 2, delta: 0.05 },
      { kind: 'put', side: 1, qty: 2, delta: 0.02 },
    ]),
    summary: 'The 112 with two cheap far-OTM puts (~2Δ) bought under the naked shorts — converting undefined crash risk into a defined, margin-friendly box.',
    why: 'Spending a slice of the 112\'s credit on 2-delta tails caps the disaster scenario: below the long tails the short and long puts move together. Margin drops from naked-put levels to spread levels, which multiplies return on capital even though the raw credit is smaller. When VIX exploded in August 2024, 1122 holders were hurt; 112 holders were hurt badly.',
    timeVol: 'Still theta-positive and net short vega, but the vega exposure is now bounded — a vol spike marks the position down without threatening ruin. The T+n curve behaves like the 112\'s until the crash region, where it flattens instead of diving.',
    management: 'Same 50% / 21-DTE management on the short puts. The long tails are usually left to expire — they are the insurance, not the trade.',
    risks: [
      'Max loss (short strikes minus tail strikes, less credit) is still multiples of the credit',
      'Mark-to-market swings on vol spikes remain large even though the endpoint is capped',
      'More legs = more slippage on entry and exit',
    ],
    sisters: 'Sits between the naked 112 and the PL5: risk-defined like the PL5, but the tails only cap losses — they never flip the crash into a gain.',
  },
  {
    id: 'pl5', name: 'PL5 (Karl Domm) — 1-2-2', ratio: '1-2-2', color: '#14b8a6', dte: 120,
    gridLo: 0.65, gridHi: 1.10, tailRisk: null,
    legs: mkLegs(120, [
      { kind: 'put', side: 1, qty: 1, delta: 0.30 },
      { kind: 'put', side: -1, qty: 2, delta: 0.18 },
      { kind: 'put', side: 1, qty: 2, delta: 0.03 },
    ]),
    summary: 'Karl Domm\'s "Premier Level 5": a crash-proof broken-wing put structure — buy 1 put ~30Δ, sell 2 ~18Δ, buy 2 far-OTM tails ~3Δ, 100–150 DTE. Non-directional, rules-based, designed to survive vol explosions without stops.',
    why: 'Read it as three ideas stacked: (1) a put front ratio (1×2) that harvests theta and skew in the tent; (2) two long tail puts that neutralize the ratio\'s naked exposure; (3) net +1 long put overall, so below the tails the position gets LONGER into a crash — positive gamma exactly when markets gap. The upper line is engineered flat: if the market rallies, all puts expire and the P/L is just the small entry cost (real-chain skew usually pushes entry to ≈ zero, so rallies cost nothing). It profits in the bull case (flat line ≈ 0, no drag), the grind-down case (tent), and the crash case (tails) — the only losing zone is a controlled decline that dies precisely between the shorts and the tails.',
    timeVol: 'The tent is theta-positive and short vega; the tails are theta-negative and long vega — so the structure is roughly vol-neutral at entry and becomes LONG vol as the market falls (long vomma, in Greek terms). That is the design insight: most income trades are short the crash twice (price and vol); the PL5 is short neither. Watch the sliders: +10 IV pts barely dents the current line, and past the tails it lifts it.',
    management: 'Rules-based by construction: fixed entry deltas and DTE, no stop-losses, exits at predefined profit or time (e.g. ~50% of duration). The claim is not "never loses" — it is that losses are shallow and predefined, so no crash decision-making is required.',
    risks: [
      'The dead zone: a slow bleed that expires between the short strikes and the tails is the max-loss path',
      'Flat-IV models (like this page) show a small debit; the real trade depends on skew richness at entry — thin skew degrades the economics',
      'Long duration ties up capital; early exits leave tent premium on the table',
      '"Crash-proof" applies to the structure, not to sizing — over-allocated defined-risk trades still ruin accounts',
    ],
    sisters: 'The 1-3-2 variant (below) adds a third short for more credit and a wider tent at the cost of a deeper dead zone. Conceptually PL5 = 112\'s income + backspread\'s tails in one ticket.',
  },
  {
    id: 'pl5b', name: 'PL5 variant — 1-3-2', ratio: '1-3-2', color: '#14b8a6', dte: 120,
    gridLo: 0.65, gridHi: 1.10, tailRisk: null,
    legs: mkLegs(120, [
      { kind: 'put', side: 1, qty: 1, delta: 0.30 },
      { kind: 'put', side: -1, qty: 3, delta: 0.18 },
      { kind: 'put', side: 1, qty: 2, delta: 0.03 },
    ]),
    summary: 'The more aggressive PL5 sibling: one extra short put in the belly (1-3-2). More credit, higher tent, flatter-to-positive upper line — paid for with a deeper valley before the tails kick in.',
    why: 'The third short usually flips the flat-IV entry from debit to credit, so the rally line sits above zero and the tent grows taller. But contract count is now balanced (3 long vs 3 short), so the crash no longer nets you extra length — the tails cap the damage and the deep-crash line flattens near the max loss instead of turning up. It trades the PL5\'s crash convexity for more income.',
    timeVol: 'More theta and more short vega than the 1-2-2 — behaviour drifts back toward the 112 family. A vol spike marks it down harder than the 1-2-2, though the tails still bound the outcome. Compare both with the IV slider at +10: the 1-2-2 shrugs, the 1-3-2 dips.',
    management: 'Same rules-based framework: fixed deltas, no stops, time-based exit. Because the valley is deeper, position sizing and the predefined exit date matter more.',
    risks: [
      'Deeper max-loss valley between shorts and tails than the 1-2-2',
      'Loses the "get longer into the crash" property — capped, not convex, below the tails',
      'Higher margin than the 1-2-2 (extra short spread embedded)',
    ],
    sisters: 'Choose 1-2-2 when you want the crash hedge built in; 1-3-2 when you want the income and accept a capped tail. Both are the "improved 112" lineage.',
  },
];

/* ── Pricing ────────────────────────────────────────────────────────────── */

function entryCost(st: RStrat): number {
  return st.legs.reduce((sum, l) => sum + l.side * l.qty * legValue(l.kind, S0, l.strike, st.dte / 365, IV0) * MULT, 0);
}

function pnlAt(st: RStrat, S: number, day: number, ivShift: number, cost: number): number {
  const T = (st.dte - day) / 365;
  const value = st.legs.reduce((sum, l) => sum + l.side * l.qty * legValue(l.kind, S, l.strike, T, IV0 + ivShift) * MULT, 0);
  return value - cost;
}

interface RStats { cost: number; maxProfit: number; maxLoss: number; breakevens: number[]; upperLine: number }

function stratStats(st: RStrat): RStats {
  const cost = entryCost(st);
  const pnl = (S: number) => pnlAt(st, S, st.dte, 0, cost);
  let maxProfit = -Infinity, maxLoss = Infinity;
  const breakevens: number[] = [];
  let prev = pnl(S0 * 0.3), prevS = S0 * 0.3;
  for (let i = 1; i <= 500; i++) {
    const S = S0 * 0.3 + (S0 * 1.5 - S0 * 0.3) * (i / 500);
    const v = pnl(S);
    maxProfit = Math.max(maxProfit, v);
    maxLoss = Math.min(maxLoss, v);
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) breakevens.push(prevS + (prev / (prev - v)) * (S - prevS));
    prev = v; prevS = S;
  }
  // naked tails: extend the scan to the extreme
  if (st.tailRisk === 'down') maxLoss = Math.min(maxLoss, pnl(1));
  if (st.tailRisk === 'up') maxLoss = -Infinity;
  const upperLine = pnl(S0 * 1.45);
  return { cost, maxProfit, maxLoss, breakevens, upperLine };
}

function fmt$(v: number): string {
  if (!isFinite(v)) return 'Unlimited';
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return sign + '$' + (a >= 1000 ? (a / 1000).toFixed(1) + 'k' : a.toFixed(0));
}

/* ── UI helpers ─────────────────────────────────────────────────────────── */

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

// Payoff sparkline for the selector cards
function Spark({ st }: { st: RStrat }) {
  const path = useMemo(() => {
    const cost = entryCost(st);
    const lo = S0 * st.gridLo, hi = S0 * st.gridHi, N = 60, W = 240, H = 64;
    const vals: number[] = [];
    for (let i = 0; i <= N; i++) vals.push(pnlAt(st, lo + (hi - lo) * (i / N), st.dte, 0, cost));
    const vMax = Math.max(...vals.map(Math.abs), 1);
    const y = (v: number) => H / 2 - (v / vMax) * (H / 2 - 5);
    const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / N) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return { line, area: `${line} L${W},${H / 2} L0,${H / 2} Z` };
  }, [st]);
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width="100%" viewBox="0 0 240 64" style={{ display: 'block' }}>
      <defs>
        <clipPath id={`u${uid}`}><rect x="0" y="0" width="240" height="32" /></clipPath>
        <clipPath id={`d${uid}`}><rect x="0" y="32" width="240" height="32" /></clipPath>
      </defs>
      <line x1="0" y1="32" x2="240" y2="32" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path.area} fill="rgba(16,185,129,0.20)" clipPath={`url(#u${uid})`} />
      <path d={path.area} fill="rgba(239,68,68,0.20)" clipPath={`url(#d${uid})`} />
      <path d={path.line} fill="none" stroke={st.color} strokeWidth="2" />
    </svg>
  );
}

const GREEK_TEXT: Record<string, Record<string, string>> = {
  delta: { long: 'gains as the market rises', short: 'gains as the market falls', flat: 'no meaningful directional lean at spot' },
  gamma: { long: 'big moves bend delta in your favor', short: 'big moves bend delta against you — wants quiet tape', flat: 'roughly linear for moderate moves' },
  theta: { long: 'earns as days pass', short: 'pays rent daily — needs the move soon', flat: 'decay roughly nets out' },
  vega:  { long: 'profits if IV rises', short: 'profits if IV falls; a spike hurts', flat: 'roughly IV-neutral right now' },
};

function GreekChip({ name, value, unit, band }: { name: string; value: number; unit: string; band: number }) {
  const exp = value > band ? 'long' : value < -band ? 'short' : 'flat';
  const color = exp === 'long' ? '#10b981' : exp === 'short' ? '#ef4444' : '#8896aa';
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-h)', fontSize: 12, fontWeight: 700, textTransform: 'capitalize' }}>{name}</span>
        <span style={{ background: color + '18', border: `1px solid ${color}50`, color, fontSize: 9, fontWeight: 700, padding: '1px 7px', borderRadius: 20 }}>
          {exp.toUpperCase()}
        </span>
      </div>
      <div style={{ color, fontSize: 16, fontWeight: 700 }}>
        {value >= 0 ? '+' : ''}{value.toFixed(name === 'gamma' ? 2 : 1)} <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{unit}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.45, marginTop: 3 }}>{GREEK_TEXT[name][exp]}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt: (v: number) => string;
}) {
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: 'var(--text)', fontSize: 12 }}>{label}</span>
        <span style={{ color: '#818cf8', fontWeight: 700, fontSize: 12 }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#6366f1' }} />
    </div>
  );
}

/* ── Comparison table data ──────────────────────────────────────────────── */

const COMPARE_ROWS = [
  ['Structure', '+1 / −1 put spread + 2 naked puts', '112 + 2 long tail puts', '+1 (30Δ) / −2 (18Δ) / +2 (3Δ) tails'],
  ['Typical cost', 'Net credit', 'Smaller net credit', '≈ zero (skew-dependent; small debit at flat IV)'],
  ['If market rallies', 'Keep the credit', 'Keep the (smaller) credit', 'Flat line ≈ entry cost — no drag'],
  ['Controlled decline', 'Debit spread pays + credit', 'Same', 'Tent over the short strikes pays'],
  ['Crash', 'Naked puts — losses to zero', 'Capped, but max loss ≫ credit', 'Tails flip it long — losses shallow, then improve'],
  ['Vega in a spike', 'Very short — doubles the pain', 'Short but bounded', '≈ neutral, turns LONG as market falls'],
  ['Margin', 'Naked-put margin (heavy)', 'Spread margin', 'Spread margin (light)'],
  ['Management', '50% TP / 21 DTE on naked puts', 'Same', 'Rules-based: fixed deltas, time exits, no stops'],
];

/* ── Main page ──────────────────────────────────────────────────────────── */

export function RatioSpreads() {
  const [selId, setSelId] = useState('pl5');
  const [day, setDay] = useState(0);
  const [ivShift, setIvShift] = useState(0);

  const st = STRATS.find(s => s.id === selId)!;
  const clampedDay = Math.min(day, st.dte - 1);
  const stats = useMemo(() => stratStats(st), [st]);

  const chartData = useMemo(() => {
    const lo = S0 * st.gridLo, hi = S0 * st.gridHi, N = 110;
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * (i / N);
      const exp = pnlAt(st, S, st.dte, ivShift, stats.cost);
      const now = pnlAt(st, S, clampedDay, ivShift, stats.cost);
      rows.push({
        price: Math.round(S),
        expiry: +exp.toFixed(0),
        now: +now.toFixed(0),
        profit: exp >= 0 ? +exp.toFixed(0) : null,
        loss: exp < 0 ? +exp.toFixed(0) : null,
      });
    }
    return rows;
  }, [st, clampedDay, ivShift, stats.cost]);

  const greeks = useMemo(() => {
    const tot = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    const T = Math.max(st.dte - clampedDay, 1) / 365;
    for (const l of st.legs) {
      const bs = blackScholes({ S: S0, K: l.strike, T, r: RATE, sigma: Math.max(0.01, (IV0 + ivShift) / 100) });
      const m = l.side * l.qty * MULT;
      tot.delta += (l.kind === 'call' ? bs.delta_call : bs.delta_put) * m;
      tot.gamma += bs.gamma * m;
      tot.theta += (l.kind === 'call' ? bs.theta_call : bs.theta_put) * m;
      tot.vega += bs.vega * m;
    }
    return tot;
  }, [st, clampedDay, ivShift]);

  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="badge-row">
        <Badge label="RATIO STRUCTURES" color="#6366f1" />
        <Badge label="SKEW HARVESTING" color="#10b981" />
        <Badge label="TAIL DESIGN" color="#14b8a6" />
        <Badge label="112 · PL5 FAMILY" color="#f59e0b" />
      </div>
      <h1 style={{ margin: '0 0 6px', fontSize: 32, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>
        Ratio Spreads: from 1×2s to the 112 and PL5
      </h1>
      <p style={{ margin: '0 0 6px', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.7 }}>
        A ratio spread buys and sells <strong>unequal numbers</strong> of options. That single asymmetry unlocks the two
        defining tricks of professional option structures: <strong>financing</strong> (extra shorts pay for your longs)
        and <strong>tail shaping</strong> (extra longs decide what a crash does to you). Every structure on this page —
        from the classic 1×2 to Tom King's 112 to Karl Domm's PL5 — is a different answer to one question:
        <em> who pays for the option you want to own, and what happens in the tail?</em>
      </p>
      <p style={{ margin: '0 0 28px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.65 }}>
        Modeled on a $6,000 SPX-like underlying, flat 20% IV, Black-Scholes values. Strikes are set by delta, the way
        these trades are actually quoted. Real index chains have put skew — which usually makes the short-heavy
        structures richer than this model shows.
      </p>

      {/* Core ideas */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14 }}>
        <RiskCard severity="info" title="1 · Financing: sell two to own one"
          body="Front ratios (1×2) sell two OTM options to pay for one closer to the money. Done for a credit there is no risk on the far side — the market paid you to hold a spread. The cost is naked exposure past the short strikes." />
        <RiskCard severity="info" title="2 · Skew: why the math works on indexes"
          body="Index put skew prices far-OTM puts above their lognormal value — crash insurance trades rich. Put-ratio structures systematically sell that rich tail and own the fairly-priced middle. It is the same edge the VRP pages describe, concentrated in the wings." />
        <RiskCard severity="info" title="3 · Tail design: naked, capped, or convex"
          body="What happens beyond the shorts is a choice. Leave it naked (1×2, 112) for maximum credit; buy cheap tails to cap it (1-1-2-2); or buy enough tails to flip the crash into profit (PL5). Same tent, three different disasters." />
      </div>

      {/* Structure selector */}
      <SectionHeader title="The Structures — click to explore" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12, marginBottom: 20 }}>
        {STRATS.map(s => {
          const sel = s.id === selId;
          const c = stratStats(s);
          return (
            <button key={s.id} onClick={() => { setSelId(s.id); setDay(0); setIvShift(0); }} style={{
              textAlign: 'left', background: sel ? s.color + '12' : 'var(--bg-card)',
              border: `1px solid ${sel ? s.color : 'var(--border)'}`,
              borderRadius: 12, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.12s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                <span style={{ color: sel ? s.color : 'var(--text-h)', fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{s.ratio} · {s.dte}d</span>
              </div>
              <Spark st={s} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10.5 }}>
                <span style={{ color: c.cost >= 0 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                  {c.cost >= 0 ? 'debit' : 'credit'} {fmt$(Math.abs(c.cost))}
                </span>
                {s.tailRisk && <span style={{ color: '#ef4444', fontWeight: 600 }}>naked {s.tailRisk === 'down' ? '↓' : '↑'} tail</span>}
                {!s.tailRisk && <span style={{ color: 'var(--text-muted)' }}>defined tail</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      <div style={{ background: 'var(--bg-card)', border: `1px solid ${st.color}60`, borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--text-h)' }}>{st.name}</h2>
          <span style={{ color: st.color, fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700 }}>{st.ratio} · {st.dte} DTE</span>
        </div>
        <p style={{ margin: '0 0 16px', color: 'var(--text)', fontSize: 13.5, lineHeight: 1.7 }}>{st.summary}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginBottom: 16 }}>
          {/* Legs */}
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>
              LEGS (SPOT $6,000 · STRIKES BY DELTA)
            </div>
            {st.legs.map((l, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6,
              }}>
                <span style={{ color: l.side === 1 ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: 11, width: 36, flexShrink: 0 }}>
                  {l.side === 1 ? 'BUY' : 'SELL'}
                </span>
                <span style={{ color: 'var(--text)', fontSize: 13 }}>
                  {l.qty}× ${l.strike.toLocaleString()} {l.kind.toUpperCase()}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
                  ~{Math.round(l.delta * 100)}Δ
                </span>
              </div>
            ))}
          </div>
          {/* Metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
            {[
              { label: stats.cost >= 0 ? 'NET DEBIT' : 'NET CREDIT', v: fmt$(Math.abs(stats.cost)), c: stats.cost >= 0 ? '#f59e0b' : '#10b981' },
              { label: 'MAX PROFIT (TENT)', v: fmt$(stats.maxProfit), c: '#10b981' },
              { label: 'MAX LOSS', v: st.tailRisk ? `${fmt$(stats.maxLoss)} (naked)` : fmt$(stats.maxLoss), c: '#ef4444' },
              { label: 'IF MARKET RALLIES AWAY', v: fmt$(stats.upperLine), c: stats.upperLine >= 0 ? '#10b981' : '#f59e0b' },
              {
                label: 'BREAKEVENS', c: '#a5b4fc',
                v: stats.breakevens.length ? stats.breakevens.map(b => '$' + Math.round(b).toLocaleString()).join(' / ') : '—',
              },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 13px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', marginBottom: 3 }}>{m.label}</div>
                <div style={{ color: m.c, fontSize: 15, fontWeight: 700 }}>{m.v}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.5 }}>
              At expiration, flat 20% IV, per 1-lot. Skew-rich real chains typically improve the credit side.
            </div>
          </div>
        </div>

        {/* Interactive chart */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
            <Slider label={`Days passed (of ${st.dte})`} value={clampedDay} min={0} max={st.dte - 1} step={1}
              onChange={setDay} fmt={v => `T+${v}`} />
            <Slider label="IV shift (all strikes)" value={ivShift} min={-10} max={15} step={1}
              onChange={setIvShift} fmt={v => `${v >= 0 ? '+' : ''}${v} pts → ${IV0 + ivShift}%`} />
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="price" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false}
                axisLine={{ stroke: 'var(--border)' }} tickFormatter={v => '$' + (v / 1000).toFixed(1) + 'k'} interval={21} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => fmt$(v)} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-h)' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : 0;
                  return [
                    <span style={{ color: v >= 0 ? '#10b981' : '#ef4444' }}>{v >= 0 ? '+' : ''}{fmt$(v)}</span>,
                    name === 'expiry' ? 'At expiration' : `T+${clampedDay}, IV ${IV0 + ivShift}%`,
                  ];
                }}
                labelFormatter={l => `Underlying: $${Number(l).toLocaleString()}`} />
              <Legend formatter={(v: string) => v === 'expiry' ? 'At expiration' : `T+${clampedDay} (IV ${IV0 + ivShift}%)`}
                wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#3b4060" strokeWidth={1.5} />
              <ReferenceLine x={S0} stroke="#8896aa" strokeWidth={1} strokeDasharray="4 4"
                label={{ value: 'spot', fill: 'var(--text-muted)', fontSize: 10, position: 'top' }} />
              <Area type="monotone" dataKey="profit" fill="rgba(16,185,129,0.10)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Area type="monotone" dataKey="loss" fill="rgba(239,68,68,0.10)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="expiry" stroke={st.color} strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="now" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            Try it: slide days forward with IV unchanged (theta), then spike IV +10 with no days passed (vega), then both —
            that combination is what an actual sell-off feels like.
          </div>
        </div>

        {/* Greeks */}
        <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>
          GREEKS AT SPOT (T+{clampedDay}, IV {IV0 + ivShift}%)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 18 }}>
          <GreekChip name="delta" value={greeks.delta} unit="share-equiv" band={8} />
          <GreekChip name="gamma" value={greeks.gamma} unit="Δ per $1" band={0.3} />
          <GreekChip name="theta" value={greeks.theta} unit="$ / day" band={1} />
          <GreekChip name="vega" value={greeks.vega} unit="$ / IV pt" band={5} />
        </div>

        {/* Narrative blocks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18 }}>
          <div>
            <div style={{ color: '#10b981', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>WHY IT WORKS</div>
            <p style={{ margin: '0 0 14px', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7 }}>{st.why}</p>
            <div style={{ color: '#8b5cf6', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>TIME & VOLATILITY</div>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7 }}>{st.timeVol}</p>
          </div>
          <div>
            <div style={{ color: '#f59e0b', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>MANAGEMENT</div>
            <p style={{ margin: '0 0 14px', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7 }}>{st.management}</p>
            <div style={{ color: '#ef4444', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>RISKS</div>
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.75 }}>
              {st.risks.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <div style={{ color: '#818cf8', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 6 }}>SISTERS & LINEAGE</div>
            <p style={{ margin: 0, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7 }}>{st.sisters}</p>
          </div>
        </div>
      </div>

      {/* Time & vol cheat sheet */}
      <SectionHeader title="How Time and Volatility Move Every Ratio Trade" color="#8b5cf6" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <RiskCard severity="info" title="Front ratios: paid to wait, hurt by spikes"
          body="Net short options → positive theta, short vega. The T+n line climbs toward the tent every quiet day, and IV crush accelerates it. The same exposure means a vol spike marks the position down before price even moves — theta and vega are two sides of the same short-option coin." />
        <RiskCard severity="info" title="Backspreads: renting convexity"
          body="Net long options → negative theta, long vega. Every day costs rent; every vol point pays. The expiry valley only exists if you hold to the end — most of the life of a backspread, the current-value line sits well above the expiry line. That gap is what you are paying theta for." />
        <RiskCard severity="info" title="PL5 family: engineered to not care"
          body="Short the belly, long the tails → theta-positive like an income trade, but vega bends positive as the market falls. Slide IV +10 on the PL5 and compare with the 112: one dips slightly, the other craters. That difference is the entire design thesis." />
      </div>

      {/* Comparison table */}
      <SectionHeader title="112 vs 1-1-2-2 vs PL5 — the same trade growing up" color="#f59e0b" />
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}></th>
              {[['The 112', '#f59e0b'], ['1-1-2-2', '#f59e0b'], ['PL5 (1-2-2)', '#14b8a6']].map(([n, c]) => (
                <th key={n} style={{ textAlign: 'left', padding: '12px 16px', color: c, fontSize: 12, fontWeight: 700, borderBottom: '1px solid var(--border)' }}>{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(([label, ...cells], ri) => (
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

      {/* Family-wide risks */}
      <SectionHeader title="Read Before Trading Any of These" color="#ef4444" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <RiskCard severity="critical" title="The tail is the trade"
          body="Every ratio structure's P&L is dominated by what you decided about the tail, not by the tent. Naked-tail versions (1×2, 112) harvest more premium for years and then give it back in one gap. Judge these strategies by their worst week, not their average month." />
        <RiskCard severity="critical" title="Flat-IV models understate both edges"
          body="This page prices everything at one flat IV. Real index skew makes short-tail structures collect more (better entries) AND makes vol spikes more violent (worse exits). Backtest with real chains before believing any expectancy number." />
        <RiskCard severity="warn" title="Margin expansion"
          body="Naked short puts consume portfolio margin dynamically — requirements balloon exactly during sell-offs. Defined-tail versions (1122, PL5) cost a little edge and buy immunity from forced liquidation, which is often the difference between a drawdown and a blow-up." />
        <RiskCard severity="warn" title="Named strategies are marketing, too"
          body="112, PL5, and friends are packaged versions of textbook structures: put front ratios, broken-wing butterflies, backspreads. Learn the components and you can price any 'proprietary' strategy yourself — including whether the packaging fee is worth it." />
      </div>

      <p style={{ margin: '36px 0 8px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
        Educational content, not investment advice. Black-Scholes model, flat 20% IV, no skew, no fees or slippage;
        PL5 details follow Karl Domm's published description (fixed entry deltas, 100–150 DTE, rules-based exits) —
        representation here is approximate and independent.
      </p>
    </div>
  );
}
