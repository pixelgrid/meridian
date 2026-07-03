import { useState, useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { blackScholes, normPdf } from '../lib/blackScholes';

// ── Types ──────────────────────────────────────────────────────────────────

interface Leg {
  id: number;
  kind: 'call' | 'put';
  side: 1 | -1;        // 1 = buy (long), -1 = sell (short)
  strike: number;
  dte: number;         // days to expiration
  qty: number;
  iv: number;          // implied volatility at entry, in %
}

type View = 'table' | 'graph' | 'greeks';
type Mode = 'pnl' | 'pnlPct' | 'value' | 'riskPct';

const RATE = 0.04;

// ── Pricing helpers ────────────────────────────────────────────────────────

function legUnitValue(leg: Leg, S: number, daysRemaining: number, ivShift: number): number {
  const T = daysRemaining / 365;
  const sigma = Math.max(0.01, (leg.iv + ivShift) / 100);
  if (T <= 0) {
    return leg.kind === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  }
  const bs = blackScholes({ S, K: leg.strike, T, r: RATE, sigma });
  return leg.kind === 'call' ? bs.call : bs.put;
}

// Entry premium per share (positive number), priced at entry IV with full DTE
function legEntryPrice(leg: Leg, spot: number): number {
  return legUnitValue(leg, spot, leg.dte, 0);
}

// Total position market value in dollars (×100 multiplier), `day` days after entry
function positionValue(legs: Leg[], spot: number, price: number, day: number, ivShift: number): number {
  void spot;
  return legs.reduce(
    (sum, leg) => sum + leg.side * leg.qty * legUnitValue(leg, price, leg.dte - day, ivShift) * 100,
    0,
  );
}

// Net cost in dollars: positive = debit paid, negative = credit received
function netCost(legs: Leg[], spot: number): number {
  return legs.reduce((sum, leg) => sum + leg.side * leg.qty * legEntryPrice(leg, spot) * 100, 0);
}

// ── Strategy detection ─────────────────────────────────────────────────────

function detectStrategy(legs: Leg[]): string {
  if (legs.length === 0) return 'Strategy Builder';
  const custom = `Custom Strategy (${legs.length} leg${legs.length > 1 ? 's' : ''})`;

  const calls = legs.filter(l => l.kind === 'call').sort((a, b) => a.strike - b.strike);
  const puts = legs.filter(l => l.kind === 'put').sort((a, b) => a.strike - b.strike);
  const expiries = [...new Set(legs.map(l => l.dte))].sort((a, b) => a - b);
  const sameExpiry = expiries.length === 1;
  const eqQty = legs.every(l => l.qty === legs[0].qty);

  // 1 leg
  if (legs.length === 1) {
    const l = legs[0];
    if (l.kind === 'call') return l.side === 1 ? 'Long Call' : 'Naked Short Call';
    return l.side === 1 ? 'Long Put' : 'Short Put (Cash-Secured)';
  }

  // 2 legs
  if (legs.length === 2) {
    const [a, b] = legs;

    if (sameExpiry) {
      // Vertical spreads & ratios (same type)
      if (a.kind === b.kind && a.side !== b.side) {
        const long = a.side === 1 ? a : b;
        const short = a.side === 1 ? b : a;
        if (long.strike === short.strike) return custom;
        if (!eqQty) {
          const kind = a.kind === 'call' ? 'Call' : 'Put';
          return long.qty > short.qty ? `${kind} Backspread` : `${kind} Ratio Spread`;
        }
        if (a.kind === 'call') {
          return long.strike < short.strike ? 'Bull Call Spread' : 'Bear Call Credit Spread';
        }
        return long.strike > short.strike ? 'Bear Put Spread' : 'Bull Put Credit Spread';
      }
      // Straddles / strangles / synthetics (call + put)
      if (a.kind !== b.kind && eqQty) {
        const call = a.kind === 'call' ? a : b;
        const put = a.kind === 'put' ? a : b;
        if (call.side === 1 && put.side === 1) {
          if (call.strike === put.strike) return 'Long Straddle';
          return put.strike < call.strike ? 'Long Strangle' : 'Long Guts';
        }
        if (call.side === -1 && put.side === -1) {
          if (call.strike === put.strike) return 'Short Straddle';
          return put.strike < call.strike ? 'Short Strangle' : 'Short Guts';
        }
        if (call.side === 1 && put.side === -1) {
          return call.strike === put.strike ? 'Synthetic Long Stock' : 'Risk Reversal (Bullish)';
        }
        return call.strike === put.strike ? 'Synthetic Short Stock' : 'Risk Reversal (Bearish)';
      }
      return custom;
    }

    // Two expirations: calendars & diagonals
    if (a.kind === b.kind && a.side !== b.side && eqQty) {
      const long = a.side === 1 ? a : b;
      const short = a.side === 1 ? b : a;
      const kind = a.kind === 'call' ? 'Call' : 'Put';
      if (long.strike === short.strike) {
        return long.dte > short.dte ? `${kind} Calendar Spread` : `Reverse ${kind} Calendar Spread`;
      }
      return long.dte > short.dte ? `${kind} Diagonal Spread` : `Reverse ${kind} Diagonal Spread`;
    }
    return custom;
  }

  // 3 legs
  if (legs.length === 3 && sameExpiry) {
    // Butterflies (all same type, 1-2-1)
    if (calls.length === 3 || puts.length === 3) {
      const ls = (calls.length === 3 ? calls : puts);
      const kind = calls.length === 3 ? 'Call' : 'Put';
      const [k1, k2, k3] = ls;
      if (k1.side === 1 && k2.side === -1 && k3.side === 1 && k2.qty === k1.qty + k3.qty) {
        const wing1 = k2.strike - k1.strike, wing2 = k3.strike - k2.strike;
        return Math.abs(wing1 - wing2) < 0.01 ? `Long ${kind} Butterfly` : `Broken Wing ${kind} Butterfly`;
      }
      if (k1.side === -1 && k2.side === 1 && k3.side === -1 && k2.qty === k1.qty + k3.qty) {
        return `Short ${kind} Butterfly`;
      }
      return custom;
    }
    // Jade lizard: short put + short call + long call above
    if (puts.length === 1 && calls.length === 2 && puts[0].side === -1 &&
        calls[0].side === -1 && calls[1].side === 1) {
      return 'Jade Lizard';
    }
    if (calls.length === 1 && puts.length === 2 && calls[0].side === -1 &&
        puts[0].side === 1 && puts[1].side === -1) {
      return 'Reverse Jade Lizard';
    }
    return custom;
  }

  // 4 legs, single expiration
  if (legs.length === 4 && sameExpiry && eqQty) {
    if (calls.length === 2 && puts.length === 2) {
      const [pLo, pHi] = puts;
      const [cLo, cHi] = calls;
      // Iron condor / iron butterfly: long put lo, short put hi, short call lo, long call hi
      if (pLo.side === 1 && pHi.side === -1 && cLo.side === -1 && cHi.side === 1 && pHi.strike <= cLo.strike) {
        return pHi.strike === cLo.strike ? 'Iron Butterfly' : 'Iron Condor';
      }
      if (pLo.side === -1 && pHi.side === 1 && cLo.side === 1 && cHi.side === -1 && pHi.strike <= cLo.strike) {
        return pHi.strike === cLo.strike ? 'Reverse Iron Butterfly' : 'Reverse Iron Condor';
      }
      // Box spread: bull call spread + bear put spread at same strikes
      if (cLo.side === 1 && cHi.side === -1 && pLo.side === -1 && pHi.side === 1 &&
          cLo.strike === pLo.strike && cHi.strike === pHi.strike) {
        return 'Box Spread';
      }
      return custom;
    }
    // All same type: condor or butterfly
    if (calls.length === 4 || puts.length === 4) {
      const ls = calls.length === 4 ? calls : puts;
      const kind = calls.length === 4 ? 'Call' : 'Put';
      const sides = ls.map(l => l.side).join(',');
      if (sides === '1,-1,-1,1') {
        return ls[1].strike === ls[2].strike ? `Long ${kind} Butterfly` : `Long ${kind} Condor`;
      }
      if (sides === '-1,1,1,-1') {
        return ls[1].strike === ls[2].strike ? `Short ${kind} Butterfly` : `Short ${kind} Condor`;
      }
      return custom;
    }
    return custom;
  }

  // 4 legs, two expirations: double calendars & double diagonals
  if (legs.length === 4 && expiries.length === 2 && calls.length === 2 && puts.length === 2 && eqQty) {
    const isTimePair = (pair: Leg[]) => {
      const long = pair.find(l => l.side === 1);
      const short = pair.find(l => l.side === -1);
      return long && short && long.dte > short.dte ? { long, short } : null;
    };
    const cp = isTimePair(calls);
    const pp = isTimePair(puts);
    if (cp && pp) {
      const callSame = cp.long.strike === cp.short.strike;
      const putSame = pp.long.strike === pp.short.strike;
      if (callSame && putSame) {
        return cp.short.strike === pp.short.strike ? 'Calendar Straddle' : 'Double Calendar Spread';
      }
      return 'Double Diagonal Spread';
    }
    return custom;
  }

  return custom;
}

// ── Analytics ──────────────────────────────────────────────────────────────

interface Analytics {
  cost: number;                     // dollars; >0 debit, <0 credit
  maxProfit: number;                // Infinity allowed
  maxLoss: number;                  // negative; -Infinity allowed
  pop: number;                      // 0..1
  breakevens: { price: number; dir: 'above' | 'below' }[];
  minDte: number;
}

function computeAnalytics(legs: Leg[], spot: number, ivShift: number): Analytics {
  if (legs.length === 0) {
    return { cost: 0, maxProfit: 0, maxLoss: 0, pop: 0, breakevens: [], minDte: 30 };
  }
  const cost = netCost(legs, spot);
  const minDte = Math.min(...legs.map(l => l.dte));
  const pnlAt = (price: number) => positionValue(legs, spot, price, minDte, ivShift) - cost;

  // Unlimited detection from net call exposure (as price → ∞ only calls matter)
  const netCalls = legs.filter(l => l.kind === 'call').reduce((s, l) => s + l.side * l.qty, 0);

  // Scan for finite extremes and breakevens
  const lo = Math.max(0.01, spot * 0.02);
  const hi = spot * 3;
  const N = 600;
  let maxProfit = -Infinity, maxLoss = Infinity;
  const breakevens: { price: number; dir: 'above' | 'below' }[] = [];
  let prevPnl = pnlAt(lo), prevPrice = lo;
  maxProfit = Math.max(maxProfit, prevPnl);
  maxLoss = Math.min(maxLoss, prevPnl);
  for (let i = 1; i <= N; i++) {
    const price = lo + (hi - lo) * (i / N);
    const pnl = pnlAt(price);
    maxProfit = Math.max(maxProfit, pnl);
    maxLoss = Math.min(maxLoss, pnl);
    if ((prevPnl < 0 && pnl >= 0) || (prevPnl >= 0 && pnl < 0)) {
      const t = prevPnl / (prevPnl - pnl);
      breakevens.push({ price: prevPrice + t * (price - prevPrice), dir: pnl >= 0 ? 'above' : 'below' });
    }
    prevPnl = pnl; prevPrice = price;
  }
  if (netCalls > 0) maxProfit = Infinity;
  if (netCalls < 0) maxLoss = -Infinity;

  // Probability of profit under lognormal at front expiration
  const T = Math.max(minDte, 0.5) / 365;
  const totQty = legs.reduce((s, l) => s + l.qty, 0);
  const sigma = Math.max(0.01, legs.reduce((s, l) => s + (l.iv + ivShift) * l.qty, 0) / totQty / 100);
  const mu = (RATE - 0.5 * sigma * sigma) * T;
  const sd = sigma * Math.sqrt(T);
  let pWin = 0, pTot = 0;
  const Z = 240;
  for (let i = 0; i <= Z; i++) {
    const z = -4 + 8 * (i / Z);
    const w = normPdf(z);
    const price = spot * Math.exp(mu + sd * z);
    pTot += w;
    if (pnlAt(price) > 0) pWin += w;
  }
  const pop = pTot > 0 ? pWin / pTot : 0;

  return { cost, maxProfit, maxLoss, pop, breakevens: breakevens.slice(0, 3), minDte };
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmtMoney(v: number, dec = 0): string {
  if (!isFinite(v)) return v > 0 ? 'Unlimited' : 'Unlimited';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 100000) return `${sign}$${(abs / 1000).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(dec)}`;
}

function dateLabel(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86400000)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Templates ──────────────────────────────────────────────────────────────

let nextId = 1;
function mkLeg(kind: 'call' | 'put', side: 1 | -1, strike: number, dte: number, qty = 1, iv = 25): Leg {
  return { id: nextId++, kind, side, strike, dte, qty, iv };
}

const TEMPLATES: { name: string; build: (S: number, R: (x: number) => number) => Leg[] }[] = [
  { name: 'Long Call', build: (S, R) => [mkLeg('call', 1, R(S), 30)] },
  { name: 'Bull Call Spread', build: (S, R) => [mkLeg('call', 1, R(S), 30), mkLeg('call', -1, R(S * 1.05), 30)] },
  { name: 'Bear Put Spread', build: (S, R) => [mkLeg('put', 1, R(S), 30), mkLeg('put', -1, R(S * 0.95), 30)] },
  { name: 'Long Straddle', build: (S, R) => [mkLeg('call', 1, R(S), 30), mkLeg('put', 1, R(S), 30)] },
  { name: 'Short Strangle', build: (S, R) => [mkLeg('call', -1, R(S * 1.07), 30), mkLeg('put', -1, R(S * 0.93), 30)] },
  {
    name: 'Iron Condor',
    build: (S, R) => [
      mkLeg('put', 1, R(S * 0.88), 30), mkLeg('put', -1, R(S * 0.93), 30),
      mkLeg('call', -1, R(S * 1.07), 30), mkLeg('call', 1, R(S * 1.12), 30),
    ],
  },
  {
    name: 'Call Butterfly',
    build: (S, R) => [mkLeg('call', 1, R(S * 0.95), 30), mkLeg('call', -1, R(S), 30, 2), mkLeg('call', 1, R(S * 1.05), 30)],
  },
  { name: 'Calendar Spread', build: (S, R) => [mkLeg('call', -1, R(S), 30), mkLeg('call', 1, R(S), 60)] },
  {
    name: 'Double Calendar',
    build: (S, R) => [
      mkLeg('put', -1, R(S * 0.95), 30), mkLeg('put', 1, R(S * 0.95), 60),
      mkLeg('call', -1, R(S * 1.05), 30), mkLeg('call', 1, R(S * 1.05), 60),
    ],
  },
  {
    name: 'Double Diagonal',
    build: (S, R) => [
      mkLeg('put', -1, R(S * 0.95), 30), mkLeg('put', 1, R(S * 0.90), 60),
      mkLeg('call', -1, R(S * 1.05), 30), mkLeg('call', 1, R(S * 1.10), 60),
    ],
  },
];

// ── Small UI pieces ────────────────────────────────────────────────────────

function MetricBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ flex: '1 1 130px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', minWidth: 130 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 19, fontWeight: 700, whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TabBtn({ active, label, onClick, accent = '#6366f1' }: { active: boolean; label: string; onClick: () => void; accent?: string }) {
  return (
    <button onClick={onClick} style={{
      background: active ? accent : 'transparent',
      border: `1px solid ${active ? accent : 'var(--border)'}`,
      color: active ? '#fff' : 'var(--text-muted)',
      fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
      transition: 'all 0.12s', whiteSpace: 'nowrap',
    }}>{label}</button>
  );
}

function Toggle<T extends string | number>({ value, options, onChange, colors }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
  colors?: Partial<Record<string, string>>;
}) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
      {options.map(o => {
        const active = o.v === value;
        const c = colors?.[String(o.v)] ?? '#6366f1';
        return (
          <button key={String(o.v)} onClick={() => onChange(o.v)} style={{
            background: active ? c : 'transparent', border: 'none',
            color: active ? '#fff' : 'var(--text-muted)', fontSize: 11, fontWeight: 700,
            padding: '5px 10px', cursor: 'pointer',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function NumInput({ value, onChange, min, step, width = 70 }: {
  value: number; onChange: (v: number) => void; min?: number; step?: number; width?: number;
}) {
  return (
    <input type="number" value={value} min={min} step={step}
      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); }}
      style={{
        width, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7,
        color: 'var(--text-h)', fontSize: 13, padding: '5px 8px', fontWeight: 600,
      }} />
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

// ── Main page ──────────────────────────────────────────────────────────────

export function StrategyBuilder() {
  const [spot, setSpot] = useState(100);
  const [legs, setLegs] = useState<Leg[]>(() => TEMPLATES[1].build(100, x => Math.round(x / 5) * 5));
  const [ivShift, setIvShift] = useState(0);       // IV points added to all legs (valuation only)
  const [daysForward, setDaysForward] = useState(0);
  const [rangePct, setRangePct] = useState(15);
  const [view, setView] = useState<View>('graph');
  const [mode, setMode] = useState<Mode>('pnl');

  const roundStrike = (x: number) => {
    const inc = spot >= 200 ? 5 : spot >= 50 ? 2.5 : 1;
    return Math.round(x / inc) * inc;
  };

  const strategyName = useMemo(() => detectStrategy(legs), [legs]);
  const analytics = useMemo(() => computeAnalytics(legs, spot, ivShift), [legs, spot, ivShift]);
  const { cost, maxProfit, maxLoss, pop, breakevens, minDte } = analytics;

  const clampedDay = Math.min(daysForward, minDte);

  // Basis for percentage modes: debit paid, or capital at risk for credit trades
  const pctBasis = cost > 0 ? cost : Math.abs(isFinite(maxLoss) ? maxLoss : cost);
  const riskBasis = Math.abs(isFinite(maxLoss) ? maxLoss : pctBasis);

  const transform = (pnl: number, value: number): number => {
    switch (mode) {
      case 'pnlPct': return pctBasis !== 0 ? (pnl / pctBasis) * 100 : 0;
      case 'value': return value;
      case 'riskPct': return riskBasis !== 0 ? (pnl / riskBasis) * 100 : 0;
      default: return pnl;
    }
  };

  const fmtCell = (v: number): string => {
    if (mode === 'pnl' || mode === 'value') return fmtMoney(v);
    return `${v >= 0 ? '' : '-'}${Math.abs(v).toFixed(0)}%`;
  };

  // ── Graph data ──
  const graphData = useMemo(() => {
    if (legs.length === 0) return [];
    const lo = spot * (1 - rangePct / 100);
    const hi = spot * (1 + rangePct / 100);
    const N = 100;
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const price = lo + (hi - lo) * (i / N);
      const vExp = positionValue(legs, spot, price, minDte, ivShift);
      const vNow = positionValue(legs, spot, price, clampedDay, ivShift);
      const pnlExp = transform(vExp - cost, vExp);
      const pnlNow = transform(vNow - cost, vNow);
      rows.push({
        price: +price.toFixed(2),
        expiry: +pnlExp.toFixed(2),
        now: +pnlNow.toFixed(2),
        profit: pnlExp >= 0 ? +pnlExp.toFixed(2) : null,
        loss: pnlExp < 0 ? +pnlExp.toFixed(2) : null,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, spot, rangePct, ivShift, clampedDay, minDte, cost, mode, pctBasis, riskBasis]);

  // ── Table data ──
  const table = useMemo(() => {
    if (legs.length === 0) return null;
    const nCols = Math.min(14, minDte + 1);
    const days = [...new Set(Array.from({ length: nCols }, (_, i) =>
      Math.round((i * minDte) / Math.max(1, nCols - 1))))];
    const nRows = 21;
    const prices = Array.from({ length: nRows }, (_, i) =>
      spot * (1 + rangePct / 100) - i * ((2 * rangePct / 100) * spot) / (nRows - 1));
    const cells = prices.map(price => days.map(day => {
      const v = positionValue(legs, spot, price, day, ivShift);
      return transform(v - cost, v);
    }));
    const maxAbs = Math.max(1e-9, ...cells.flat().map(Math.abs));
    return { days, prices, cells, maxAbs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, spot, rangePct, ivShift, minDte, cost, mode, pctBasis, riskBasis]);

  // ── Greeks ──
  const greeks = useMemo(() => {
    const rows = legs.map(leg => {
      const T = Math.max(leg.dte - clampedDay, 0.01) / 365;
      const sigma = Math.max(0.01, (leg.iv + ivShift) / 100);
      const bs = blackScholes({ S: spot, K: leg.strike, T, r: RATE, sigma });
      const mult = leg.side * leg.qty * 100;
      return {
        leg,
        delta: (leg.kind === 'call' ? bs.delta_call : bs.delta_put) * mult,
        gamma: bs.gamma * mult,
        theta: (leg.kind === 'call' ? bs.theta_call : bs.theta_put) * mult,
        vega: bs.vega * mult,
        price: legUnitValue(leg, spot, leg.dte - clampedDay, ivShift),
      };
    });
    const tot = rows.reduce(
      (a, r) => ({ delta: a.delta + r.delta, gamma: a.gamma + r.gamma, theta: a.theta + r.theta, vega: a.vega + r.vega }),
      { delta: 0, gamma: 0, theta: 0, vega: 0 },
    );
    return { rows, tot };
  }, [legs, spot, ivShift, clampedDay]);

  // ── Leg mutations ──
  const updateLeg = (id: number, patch: Partial<Leg>) =>
    setLegs(ls => ls.map(l => (l.id === id ? { ...l, ...patch } : l)));
  const removeLeg = (id: number) => setLegs(ls => ls.filter(l => l.id !== id));
  const addLeg = (kind: 'call' | 'put') =>
    setLegs(ls => [...ls, mkLeg(kind, 1, roundStrike(spot), 30)]);

  const cellStyle = (v: number, maxAbs: number): React.CSSProperties => {
    const t = Math.min(1, Math.abs(v) / maxAbs);
    const alpha = 0.10 + 0.72 * t;
    return {
      background: v >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`,
      color: t > 0.35 ? '#fff' : 'var(--text-h)',
      padding: '3px 6px', fontSize: 11, fontWeight: 600, textAlign: 'right',
      whiteSpace: 'nowrap', minWidth: 44,
    };
  };

  const modeLabel: Record<Mode, string> = {
    pnl: 'P/L $', pnlPct: 'P/L %', value: 'Contract Value', riskPct: '% of Max Risk',
  };

  return (
    <div className="page-wrap">
      {/* Dynamic header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>
          {strategyName}
        </h1>
        <span style={{
          background: '#6366f118', border: '1px solid #6366f150', color: '#818cf8',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '3px 10px', borderRadius: 20,
        }}>AUTO-DETECTED</span>
      </div>
      <p style={{ margin: '0 0 20px', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
        Build any options position leg by leg — the payoff, metrics and strategy name update live.
        Prices are model values (Black-Scholes, {(RATE * 100).toFixed(0)}% rate, no dividends).
      </p>

      {/* Underlying + templates */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>UNDERLYING PRICE</span>
            <NumInput value={spot} min={1} step={1} width={86} onChange={v => setSpot(Math.max(1, v))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em' }}>TEMPLATES</span>
            {TEMPLATES.map(t => (
              <button key={t.name} onClick={() => setLegs(t.build(spot, roundStrike))} style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
                fontSize: 11, padding: '4px 9px', borderRadius: 7, cursor: 'pointer',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#818cf8'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)'; }}>
                {t.name}
              </button>
            ))}
          </div>
        </div>

        {/* Leg editor */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {legs.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
              No legs yet — add a call or put below, or pick a template.
            </div>
          )}
          {legs.map(leg => {
            const entry = legEntryPrice(leg, spot);
            return (
              <div key={leg.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px',
              }}>
                <Toggle value={leg.side} onChange={v => updateLeg(leg.id, { side: v })}
                  options={[{ v: 1 as const, label: 'BUY' }, { v: -1 as const, label: 'SELL' }]}
                  colors={{ '1': '#10b981', '-1': '#ef4444' }} />
                <Toggle value={leg.kind} onChange={v => updateLeg(leg.id, { kind: v })}
                  options={[{ v: 'call' as const, label: 'CALL' }, { v: 'put' as const, label: 'PUT' }]}
                  colors={{ call: '#6366f1', put: '#8b5cf6' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  Strike
                  <NumInput value={leg.strike} min={0.5} step={1} width={70}
                    onChange={v => updateLeg(leg.id, { strike: Math.max(0.5, v) })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  DTE
                  <NumInput value={leg.dte} min={1} step={1} width={58}
                    onChange={v => updateLeg(leg.id, { dte: Math.max(1, Math.round(v)) })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  Qty
                  <NumInput value={leg.qty} min={1} step={1} width={52}
                    onChange={v => updateLeg(leg.id, { qty: Math.max(1, Math.round(v)) })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)', fontSize: 11 }}>
                  IV %
                  <NumInput value={leg.iv} min={1} step={1} width={56}
                    onChange={v => updateLeg(leg.id, { iv: Math.max(1, v) })} />
                </label>
                <span style={{ color: leg.side === 1 ? '#ef4444' : '#10b981', fontSize: 12, fontWeight: 700, marginLeft: 'auto' }}>
                  {leg.side === 1 ? 'pay' : 'collect'} ${(entry * 100 * leg.qty).toFixed(0)}
                </span>
                <button onClick={() => removeLeg(leg.id)} title="Remove leg" style={{
                  background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  width: 26, height: 26, borderRadius: 7, cursor: 'pointer', fontSize: 13, lineHeight: 1,
                }}>×</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <TabBtn active={false} label="+ Add Call" onClick={() => addLeg('call')} />
          <TabBtn active={false} label="+ Add Put" onClick={() => addLeg('put')} />
          {legs.length > 0 && <TabBtn active={false} label="Clear All" onClick={() => setLegs([])} accent="#ef4444" />}
        </div>
      </div>

      {/* Metrics bar */}
      {legs.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <MetricBox label={cost >= 0 ? 'NET DEBIT' : 'NET CREDIT'} value={fmtMoney(Math.abs(cost))}
            color={cost >= 0 ? '#f59e0b' : '#10b981'} />
          <MetricBox label="MAX LOSS" value={isFinite(maxLoss) ? fmtMoney(maxLoss) : 'Unlimited'}
            color="#ef4444" sub={`at front expiry (${dateLabel(minDte)})`} />
          <MetricBox label="MAX PROFIT" value={isFinite(maxProfit) ? fmtMoney(maxProfit) : 'Unlimited'}
            color="#10b981" sub={`at front expiry (${dateLabel(minDte)})`} />
          <MetricBox label="CHANCE OF PROFIT" value={`${(pop * 100).toFixed(0)}%`} color="#818cf8"
            sub="lognormal model estimate" />
          <MetricBox label="BREAKEVEN" color="#a5b4fc"
            value={breakevens.length === 0 ? '—'
              : breakevens.map(b => `$${b.price.toFixed(2)}`).join(' / ')}
            sub={breakevens.length > 0
              ? breakevens.map(b => `${b.dir === 'above' ? '↑' : '↓'}${((b.price / spot - 1) * 100).toFixed(1)}%`).join('  ')
              : 'no zero crossing'} />
        </div>
      )}

      {/* Scenario controls */}
      {legs.length > 0 && (
        <div style={{
          display: 'flex', gap: 20, flexWrap: 'wrap', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 10, padding: '14px 20px', marginBottom: 14,
        }}>
          <Slider label="Implied volatility shift" value={ivShift} min={-30} max={30} step={1}
            onChange={setIvShift} fmt={v => `${v >= 0 ? '+' : ''}${v} pts`} />
          <Slider label={`Days from today (of ${minDte})`} value={clampedDay} min={0} max={minDte} step={1}
            onChange={setDaysForward} fmt={v => `T+${v} (${dateLabel(v)})`} />
          <Slider label="Chart range" value={rangePct} min={5} max={50} step={1}
            onChange={setRangePct} fmt={v => `±${v}%`} />
        </div>
      )}

      {/* View + mode tabs */}
      {legs.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <TabBtn active={view === 'table'} label="▦ Table" onClick={() => setView('table')} />
          <TabBtn active={view === 'graph'} label="📈 Graph" onClick={() => setView('graph')} />
          <TabBtn active={view === 'greeks'} label="Δ Greeks" onClick={() => setView('greeks')} />
          {view !== 'greeks' && (
            <>
              <div style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 4px' }} />
              {(Object.keys(modeLabel) as Mode[]).map(m => (
                <TabBtn key={m} active={mode === m} label={modeLabel[m]} onClick={() => setMode(m)} accent="#0ea5e9" />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Graph view ── */}
      {legs.length > 0 && view === 'graph' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 20px' }}>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={graphData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="price" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false}
                axisLine={{ stroke: 'var(--border)' }} tickFormatter={v => `$${v}`} interval={19} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => mode === 'pnl' || mode === 'value' ? fmtMoney(v) : `${v.toFixed(0)}%`} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-h)' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : 0;
                  const label = name === 'expiry' ? `At expiration (${dateLabel(minDte)})` : `T+${clampedDay} (${dateLabel(clampedDay)})`;
                  return [
                    <span style={{ color: v >= 0 ? '#10b981' : '#ef4444' }}>{fmtCell(v)}</span>,
                    label,
                  ];
                }}
                labelFormatter={l => `Underlying: $${l}`} />
              <Legend formatter={(v: string) => v === 'expiry' ? `At expiration (${dateLabel(minDte)})` : `T+${clampedDay} (${dateLabel(clampedDay)})`}
                wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#3b4060" strokeWidth={1.5} />
              <ReferenceLine x={spot} stroke="#8896aa" strokeWidth={1} strokeDasharray="4 4"
                label={{ value: 'spot', fill: 'var(--text-muted)', fontSize: 10, position: 'top' }} />
              {breakevens.map((b, i) => (
                <ReferenceLine key={i} x={+b.price.toFixed(2)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="2 3" />
              ))}
              <Area type="monotone" dataKey="profit" fill="rgba(16,185,129,0.12)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Area type="monotone" dataKey="loss" fill="rgba(239,68,68,0.12)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="expiry" stroke="#6366f1" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="now" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Table view ── */}
      {legs.length > 0 && view === 'table' && table && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-card)' }}>
                  {modeLabel[mode]}
                </th>
                {table.days.map(d => (
                  <th key={d} style={{ padding: '4px 6px', color: d === minDte ? '#818cf8' : 'var(--text-muted)', fontSize: 10, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {dateLabel(d)}{d === minDte ? ' ⏱' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.prices.map((price, ri) => {
                const pct = (price / spot - 1) * 100;
                const isSpotRow = Math.abs(pct) < (rangePct / 10);
                return (
                  <tr key={ri} style={isSpotRow ? { outline: '1px dashed #8896aa' } : undefined}>
                    <td style={{ padding: '3px 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-h)', whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--bg-card)' }}>
                      ${price.toFixed(spot < 50 ? 1 : 0)}
                      <span style={{ color: pct >= 0 ? '#10b981' : '#ef4444', fontWeight: 600, fontSize: 9, marginLeft: 5 }}>
                        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                      </span>
                    </td>
                    {table.cells[ri].map((v, ci) => (
                      <td key={ci} style={cellStyle(v, table.maxAbs)}>{fmtCell(v)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
            Rows: underlying price · Columns: calendar date (⏱ = front expiration) · IV shift and all leg edits update the matrix live.
          </div>
        </div>
      )}

      {/* ── Greeks view ── */}
      {legs.length > 0 && view === 'greeks' && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 560 }}>
            <thead>
              <tr>
                {['Leg', 'Model Price', 'Delta', 'Gamma', 'Theta/day', 'Vega'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Leg' ? 'left' : 'right', padding: '8px 12px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {greeks.rows.map(r => (
                <tr key={r.leg.id}>
                  <td style={{ padding: '8px 12px', color: 'var(--text-h)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: r.leg.side === 1 ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                      {r.leg.side === 1 ? 'BUY' : 'SELL'}
                    </span>{' '}
                    {r.leg.qty}× ${r.leg.strike} {r.leg.kind.toUpperCase()} · {r.leg.dte}d · IV {r.leg.iv}%
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>${r.price.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: r.delta >= 0 ? '#10b981' : '#ef4444', borderBottom: '1px solid var(--border)' }}>{r.delta.toFixed(1)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>{r.gamma.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: r.theta >= 0 ? '#10b981' : '#ef4444', borderBottom: '1px solid var(--border)' }}>${r.theta.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: r.vega >= 0 ? '#10b981' : '#ef4444', borderBottom: '1px solid var(--border)' }}>${r.vega.toFixed(2)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '10px 12px', color: '#818cf8', fontWeight: 700 }}>TOTAL POSITION (T+{clampedDay}, spot ${spot})</td>
                <td></td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: greeks.tot.delta >= 0 ? '#10b981' : '#ef4444' }}>{greeks.tot.delta.toFixed(1)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text-h)' }}>{greeks.tot.gamma.toFixed(2)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: greeks.tot.theta >= 0 ? '#10b981' : '#ef4444' }}>${greeks.tot.theta.toFixed(2)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: greeks.tot.vega >= 0 ? '#10b981' : '#ef4444' }}>${greeks.tot.vega.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 8 }}>
            Delta/gamma in share-equivalents (×100 per contract) · theta per calendar day · vega per 1 IV point.
          </div>
        </div>
      )}

      <p style={{ margin: '28px 0 8px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
        Educational tool — model prices only, not live market quotes. Assumes constant IV across strikes (no skew),
        European exercise, no dividends or transaction costs.
      </p>
    </div>
  );
}
