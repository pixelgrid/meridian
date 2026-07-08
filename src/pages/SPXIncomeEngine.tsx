import { useState, useMemo } from 'react';
import { normCdf } from '../lib/blackScholes';

/* ============ MATH CORE ============ */

const R = 0.04; // risk-free
const MULT = 100;
const TF = 7 / 365, TB = 14 / 365;

// Acklam approximation of the inverse normal CDF
function normInv(prob: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  let q: number, r: number;
  if (prob < pl) {
    q = Math.sqrt(-2 * Math.log(prob));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (prob <= 1 - pl) {
    q = prob - 0.5; r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - prob));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

function bsPrice(S: number, K: number, T: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0) return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (R + (sigma * sigma) / 2) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  if (type === 'call') return S * normCdf(d1) - K * Math.exp(-R * T) * normCdf(d2);
  return K * Math.exp(-R * T) * normCdf(-d2) - S * normCdf(-d1);
}

// probability S_T > x under lognormal with vol sigma, horizon T
function probAbove(S: number, x: number, T: number, sigma: number): number {
  const d2 = (Math.log(S / x) + (R - (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d2);
}

function deltaToStrike(S: number, sigma: number, T: number, delta: number, type: 'call' | 'put'): number {
  const d1 = type === 'put' ? normInv(1 - delta) : normInv(delta);
  return S * Math.exp((R + (sigma * sigma) / 2) * T - d1 * sigma * Math.sqrt(T));
}

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

/* ============ FORMATTING ============ */

function fmt$(v: number): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  return sign + '$' + (a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : a.toFixed(0));
}
const fmtPct = (v: number, d = 1) => (v * 100).toFixed(d) + '%';

/* ============ STRATEGY BUILDERS ============ */

interface BuildParams {
  S: number; ivF: number; ivB: number; Tf: number; Tb: number;
  pop: number; capital: number; strikeStep: number; mult: number;
}

interface StratLeg { side: 'SELL' | 'BUY'; type: 'PUT' | 'CALL'; strike: number; exp: string }

interface Strategy {
  key: string; name: string; dteLabel: string;
  legs: StratLeg[];
  creditDebit: { label: string; val: number };
  maxRisk: number; contracts: number; popModel: number | null;
  tp: string; sl: string; timeExit: string; entry: string;
  evWeekly: number; breakevens: number[] | null;
  payoff: (grid: number[]) => number[];
  notes: string;
}

interface ScoredStrategy extends Strategy { score: number; pl: number[]; popFinal: number }

function buildPCS({ S, ivF, Tf, pop, capital, strikeStep, mult }: BuildParams): Strategy {
  const shortDelta = Math.min(0.35, Math.max(0.05, 1 - pop));
  const width = strikeStep >= 5 ? 50 : 5;
  const Ks = roundTo(deltaToStrike(S, ivF, Tf, shortDelta, 'put'), strikeStep);
  const Kl = Ks - width;
  const credit = Math.max(0.05, bsPrice(S, Ks, Tf, ivF, 'put') - bsPrice(S, Kl, Tf, ivF, 'put'));
  const maxRisk = (width - credit) * mult;
  const be = Ks - credit;
  const popModel = probAbove(S, be, Tf, ivF);
  const contracts = Math.floor(capital / maxRisk);
  const winP = Math.min(0.96, popModel + 0.05); // managed at 50% TP
  const evPerCt = winP * 0.5 * credit * mult - (1 - winP) * 2.0 * credit * mult;
  return {
    key: 'pcs', name: 'Put Credit Spread', dteLabel: '7 DTE',
    legs: [
      { side: 'SELL', type: 'PUT', strike: Ks, exp: 'front (7d)' },
      { side: 'BUY', type: 'PUT', strike: Kl, exp: 'front (7d)' },
    ],
    creditDebit: { label: 'Credit', val: credit * mult },
    maxRisk, contracts, popModel,
    tp: `Buy back at 50% of credit (${fmt$(0.5 * credit * mult)}/ct)`,
    sl: `Exit at 2× credit loss (${fmt$(2 * credit * mult)}/ct) or short strike touched`,
    timeExit: 'Close by 1 DTE — never hold SPX AM settlement',
    entry: 'Enter Thu/Fri for next-week expiry; skip if major macro event inside window',
    evWeekly: (contracts > 0 ? contracts : 0) * evPerCt,
    breakevens: [be],
    payoff: (grid) => grid.map((s) => (credit - Math.max(Ks - s, 0) + Math.max(Kl - s, 0)) * mult),
    notes: "Pure VRP harvest — the statistically strongest side per spintwig's SPX studies. Delta-positive: pairs with a mildly bullish/neutral view.",
  };
}

function buildIC({ S, ivF, Tf, pop, capital, strikeStep, mult }: BuildParams): Strategy {
  const perSide = Math.min(0.25, Math.max(0.04, (1 - pop) / 2));
  const putD = perSide * 1.1;      // put side carries the edge
  const callD = perSide * 0.75;    // call side skewed further out (systematically weaker side)
  const width = strikeStep >= 5 ? 50 : 5;
  const Kps = roundTo(deltaToStrike(S, ivF, Tf, putD, 'put'), strikeStep);
  const Kpl = Kps - width;
  const Kcs = roundTo(deltaToStrike(S, ivF, Tf, callD, 'call'), strikeStep);
  const Kcl = Kcs + width;
  const credit = Math.max(
    0.05,
    bsPrice(S, Kps, Tf, ivF, 'put') - bsPrice(S, Kpl, Tf, ivF, 'put') +
    bsPrice(S, Kcs, Tf, ivF, 'call') - bsPrice(S, Kcl, Tf, ivF, 'call')
  );
  const maxRisk = (width - credit) * mult;
  const beP = Kps - credit, beC = Kcs + credit;
  const popModel = Math.max(0, probAbove(S, beP, Tf, ivF) - probAbove(S, beC, Tf, ivF));
  const contracts = Math.floor(capital / maxRisk);
  const winP = Math.min(0.94, popModel + 0.08);
  const evPerCt = winP * 0.5 * credit * mult - (1 - winP) * 2.0 * credit * mult;
  return {
    key: 'ic', name: 'Iron Condor (call-skewed)', dteLabel: '7 DTE',
    legs: [
      { side: 'SELL', type: 'PUT', strike: Kps, exp: 'front (7d)' },
      { side: 'BUY', type: 'PUT', strike: Kpl, exp: 'front (7d)' },
      { side: 'SELL', type: 'CALL', strike: Kcs, exp: 'front (7d)' },
      { side: 'BUY', type: 'CALL', strike: Kcl, exp: 'front (7d)' },
    ],
    creditDebit: { label: 'Credit', val: credit * mult },
    maxRisk, contracts, popModel,
    tp: `Buy back at 50% of credit (${fmt$(0.5 * credit * mult)}/ct)`,
    sl: `Exit at 200% of credit (${fmt$(2 * credit * mult)}/ct) or either short strike breached`,
    timeExit: 'Close by 1 DTE',
    entry: "Enter Thu/Fri for next week; call side deliberately further OTM — it's the weaker edge",
    evWeekly: (contracts > 0 ? contracts : 0) * evPerCt,
    breakevens: [beP, beC],
    payoff: (grid) => grid.map((s) =>
      (credit - Math.max(Kps - s, 0) + Math.max(Kpl - s, 0) - Math.max(s - Kcs, 0) + Math.max(s - Kcl, 0)) * mult),
    notes: "Delta-neutral premium collection. Realized win rate ≈80% when managed at 50% TP / 200% SL. Call wing dilutes edge, so it's skewed further out here.",
  };
}

function buildDC({ S, ivF, ivB, Tf, Tb, capital, strikeStep, mult }: BuildParams): Strategy {
  const em = S * ivF * Math.sqrt(Tf); // 1σ expected move, front expiry
  const Kp = roundTo(S - em, strikeStep);
  const Kc = roundTo(S + em, strikeStep);
  const debit = Math.max(
    0.05,
    (bsPrice(S, Kp, Tb, ivB, 'put') - bsPrice(S, Kp, Tf, ivF, 'put')) +
    (bsPrice(S, Kc, Tb, ivB, 'call') - bsPrice(S, Kc, Tf, ivF, 'call'))
  );
  const maxRisk = debit * mult;
  const contracts = Math.floor(capital / maxRisk);
  const Tr = Tb - Tf; // time left on longs at short expiry
  const payoff = (grid: number[]) => grid.map((s) =>
    (bsPrice(s, Kp, Tr, ivB, 'put') + bsPrice(s, Kc, Tr, ivB, 'call')
      - Math.max(Kp - s, 0) - Math.max(s - Kc, 0) - debit) * mult);
  const winP = 0.68;
  const evPerCt = winP * 0.20 * maxRisk - (1 - winP) * 0.25 * maxRisk;
  return {
    key: 'dc', name: 'Double Calendar', dteLabel: '7 / 14 DTE',
    legs: [
      { side: 'SELL', type: 'PUT', strike: Kp, exp: 'front (7d)' },
      { side: 'BUY', type: 'PUT', strike: Kp, exp: 'back (14d)' },
      { side: 'SELL', type: 'CALL', strike: Kc, exp: 'front (7d)' },
      { side: 'BUY', type: 'CALL', strike: Kc, exp: 'back (14d)' },
    ],
    creditDebit: { label: 'Debit', val: debit * mult },
    maxRisk, contracts, popModel: null,
    tp: `Close at +20% of debit (${fmt$(0.2 * maxRisk)}/ct); start scaling at +15%`,
    sl: `Exit at −25% of debit (${fmt$(0.25 * maxRisk)}/ct) or IV term structure flips against you`,
    timeExit: 'Exit by ~1/3 of duration (2–3 days in) or 1 DTE on shorts, whichever first',
    entry: 'Enter Tue/Wed. Strikes at ±1σ expected move. Long vega: skip if VIX elevated & likely to crush',
    evWeekly: (contracts > 0 ? contracts : 0) * evPerCt,
    breakevens: null, payoff,
    notes: 'Wide theta tent, long vega. Best in low VIX or front>back backwardation. P&L curve shown at short-leg expiry (back IV held constant — real vega moves dominate).',
  };
}

function buildDD({ S, ivF, ivB, Tf, Tb, capital, strikeStep, mult }: BuildParams): Strategy {
  const em = S * ivF * Math.sqrt(Tf);
  const off = strikeStep >= 5 ? roundTo(em * 0.35, strikeStep) : Math.max(1, Math.round(em * 0.35));
  const Kps = roundTo(S - em, strikeStep), Kpl = Kps - off;
  const Kcs = roundTo(S + em, strikeStep), Kcl = Kcs + off;
  const debit =
    (bsPrice(S, Kpl, Tb, ivB, 'put') - bsPrice(S, Kps, Tf, ivF, 'put')) +
    (bsPrice(S, Kcl, Tb, ivB, 'call') - bsPrice(S, Kcs, Tf, ivF, 'call'));
  const maxRisk = (Math.max(0, debit) + off) * mult; // worst case ≈ offset + net debit
  const contracts = Math.floor(capital / maxRisk);
  const Tr = Tb - Tf;
  const payoff = (grid: number[]) => grid.map((s) =>
    (bsPrice(s, Kpl, Tr, ivB, 'put') + bsPrice(s, Kcl, Tr, ivB, 'call')
      - Math.max(Kps - s, 0) - Math.max(s - Kcs, 0) - debit) * mult);
  const winP = 0.70;
  const evPerCt = winP * 0.15 * maxRisk - (1 - winP) * 0.20 * maxRisk;
  return {
    key: 'dd', name: 'Double Diagonal', dteLabel: '7 / 14 DTE',
    legs: [
      { side: 'SELL', type: 'PUT', strike: Kps, exp: 'front (7d)' },
      { side: 'BUY', type: 'PUT', strike: Kpl, exp: 'back (14d)' },
      { side: 'SELL', type: 'CALL', strike: Kcs, exp: 'front (7d)' },
      { side: 'BUY', type: 'CALL', strike: Kcl, exp: 'back (14d)' },
    ],
    creditDebit: { label: debit >= 0 ? 'Debit' : 'Credit', val: Math.abs(debit) * mult },
    maxRisk, contracts, popModel: null,
    tp: `Close at +15% of max risk (${fmt$(0.15 * maxRisk)}/ct)`,
    sl: `Exit at −20% of max risk (${fmt$(0.2 * maxRisk)}/ct)`,
    timeExit: 'Exit by 1 DTE on shorts; roll shorts only if tent still holds',
    entry: 'Enter Tue/Wed. Shorts at ±1σ, longs one notch further out — flatter vega than the DC',
    evWeekly: (contracts > 0 ? contracts : 0) * evPerCt,
    breakevens: null, payoff,
    notes: 'Wider, flatter tent than the DC and less vega-fragile — the regime bridge when VIX sits 18–24 and calendars feel exposed to crush.',
  };
}

/* ============ REGIME + SCORING ============ */

function classifyRegime(vix: number, slopePct: number) {
  const structure = slopePct > 0.5 ? 'BACKWARDATION' : slopePct < -0.5 ? 'CONTANGO' : 'FLAT';
  let vol: 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH';
  if (vix < 14) vol = 'LOW';
  else if (vix < 20) vol = 'NORMAL';
  else if (vix < 26) vol = 'ELEVATED';
  else vol = 'HIGH';
  return { vol, structure };
}

function scoreAll(vix: number, slopePct: number, pop: number): Record<string, number> {
  const s: Record<string, number> = {};
  // PCS
  let pcs = 62;
  if (vix >= 14 && vix <= 30) pcs += 16; else if (vix < 12) pcs -= 14;
  if (vix > 33) pcs -= 12;
  if (pop >= 0.78) pcs += 8;
  s.pcs = pcs;
  // IC
  let ic = 55;
  if (vix >= 15 && vix <= 25) ic += 14;
  if (vix > 30) ic -= 18;
  if (pop >= 0.65 && pop <= 0.85) ic += 8;
  s.ic = ic;
  // DC
  let dc = 55;
  if (vix < 16) dc += 20;
  if (slopePct > 0.5) dc += 18;
  if (vix > 24 && slopePct < 0) dc -= 25;
  if (vix >= 16 && vix <= 20 && slopePct <= 0) dc -= 5;
  if (pop > 0.85) dc -= 8; // DCs can't deliver 85%+ POP honestly
  s.dc = dc;
  // DD
  let dd = 55;
  if (vix < 18) dd += 12;
  if (vix >= 18 && vix <= 24) dd += 8;
  if (slopePct > 0.5) dd += 10;
  if (vix > 27) dd -= 18;
  s.dd = dd;
  Object.keys(s).forEach((k) => (s[k] = Math.max(5, Math.min(98, s[k]))));
  return s;
}

/* ============ THEME (app CSS variables — light & dark) ============ */

const C = {
  panel: 'var(--bg-card)', panel2: 'var(--bg)', line: 'var(--border)',
  text: 'var(--text-h)', dim: 'var(--text-muted)', faint: 'var(--text-muted)',
  income: 'var(--profit)', vega: '#14b8a6', warn: 'var(--neutral)', risk: 'var(--loss)', accent: 'var(--accent)',
};
const mono = "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace";

/* ============ PAYOFF CHART ============ */

function PayoffChart({ grid, pl, spot, color }: { grid: number[]; pl: number[]; spot: number; color: string }) {
  const W = 560, H = 130, pad = 6;
  const minPl = Math.min(...pl), maxPl = Math.max(...pl);
  const range = Math.max(1, maxPl - minPl);
  const x = (s: number) => pad + ((s - grid[0]) / (grid[grid.length - 1] - grid[0])) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - minPl) / range) * (H - 2 * pad);
  const path = grid.map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(pl[i]).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  const areaTop = grid.map((s, i) => `${i ? 'L' : 'M'}${x(s).toFixed(1)},${y(Math.max(0, pl[i])).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <path d={`${areaTop} L${x(grid[grid.length - 1])},${zeroY} L${x(grid[0])},${zeroY} Z`} fill={color} opacity="0.13" />
      <line x1={pad} x2={W - pad} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
      <line x1={x(spot)} x2={x(spot)} y1={pad} y2={H - pad} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="2 3" />
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      <text x={x(spot) + 4} y={pad + 10} fill="var(--text-muted)" fontSize="9" fontFamily={mono}>spot</text>
    </svg>
  );
}

/* ============ UI PRIMITIVES ============ */

function Field({ label, suffix, value, onChange, step = 1 }: {
  label: string; suffix?: string; value: number; onChange: (v: number) => void; step?: number;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: C.faint, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 6 }}>
        <input
          type="number" value={value} step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: C.text, fontFamily: mono, fontSize: 15, padding: '8px 10px' }}
        />
        {suffix && <span style={{ color: C.faint, fontSize: 11, paddingRight: 10, fontFamily: mono }}>{suffix}</span>}
      </div>
    </label>
  );
}

function Slider({ label, value, onChange, min, max, step, display }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; display: string;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, letterSpacing: '0.12em', color: C.faint, textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: 13, color: C.text }}>{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.1em', color: C.faint, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 15, color: color || C.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

/* ============ LIVE DATA (CBOE delayed quotes, ~15 min) ============ */

const CORS_PROXY = 'https://cors-proxy-nine-virid.vercel.app/proxy?url=';

async function cboeQuote(symbol: string): Promise<number> {
  const target = `https://cdn.cboe.com/api/global/delayed_quotes/quotes/${symbol}.json`;
  const res = await fetch(CORS_PROXY + encodeURIComponent(target));
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const price = json?.data?.current_price;
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) throw new Error(`${symbol}: no price in response`);
  return price;
}

/* ============ MAIN ============ */

export function SPXIncomeEngine() {
  const [und, setUnd] = useState<'SPX' | 'XSP'>('SPX');
  const [spot, setSpot] = useState(6200);
  const [ivF, setIvF] = useState(13.5);   // front IV %
  const [ivB, setIvB] = useState(14.5);   // back IV %
  const [vix, setVix] = useState(15.5);
  const [capital, setCapital] = useState(20000);
  const [yieldT, setYieldT] = useState(0.8);  // % weekly
  const [popT, setPopT] = useState(78);       // %

  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function fetchLive() {
    setFetching(true);
    setFetchMsg(null);
    try {
      const [spx, vixQ, vix9d] = await Promise.all([
        cboeQuote('_SPX'), cboeQuote('_VIX'), cboeQuote('_VIX9D'),
      ]);
      setSpot(und === 'XSP' ? Math.round(spx / 10) : Math.round(spx));
      setVix(+vixQ.toFixed(2));
      // VIX9D ≈ 9-day ATM IV → proxy for 7-DTE front IV.
      // Back IV (14d) interpolated between VIX9D (9d) and VIX (30d).
      const front = vix9d;
      const back = vix9d + (vixQ - vix9d) * ((14 - 9) / (30 - 9));
      setIvF(+front.toFixed(1));
      setIvB(+back.toFixed(1));
      setFetchMsg({
        ok: true,
        text: `Updated ${new Date().toLocaleTimeString()} — CBOE delayed quotes (~15 min). Front IV ≈ VIX9D; back IV interpolated VIX9D→VIX. Verify against the live chain before trading.`,
      });
    } catch (e) {
      setFetchMsg({
        ok: false,
        text: `Fetch failed (${e instanceof Error ? e.message : String(e)}) — enter values manually or try again later.`,
      });
    } finally {
      setFetching(false);
    }
  }

  const out = useMemo(() => {
    const strikeStep = und === 'SPX' ? 5 : 1;
    const S = spot;
    const f = ivF / 100, b = ivB / 100, pop = popT / 100;
    const slopePct = ivF - ivB; // in vol points; >0 = backwardation
    const regime = classifyRegime(vix, slopePct);
    const scores = scoreAll(vix, slopePct, pop);
    const common: BuildParams = { S, ivF: f, ivB: b, Tf: TF, Tb: TB, pop, capital, strikeStep, mult: MULT };
    const em = S * f * Math.sqrt(TF);
    // payoff grid ±2.2σ
    const grid: number[] = [];
    const lo = S - 2.2 * em, hi = S + 2.2 * em, n = 120;
    for (let i = 0; i <= n; i++) grid.push(lo + ((hi - lo) * i) / n);

    const strategies: ScoredStrategy[] = [buildPCS(common), buildIC(common), buildDC(common), buildDD(common)]
      .map((st) => ({ ...st, score: scores[st.key] }))
      .sort((a, b2) => b2.score - a.score)
      .map((st) => {
        const pl = st.payoff(grid);
        // model POP for tent strategies from the payoff grid
        let popFinal = st.popModel ?? 0;
        if (st.popModel == null) {
          let prob = 0;
          for (let i = 0; i < grid.length - 1; i++) {
            if (pl[i] > 0) prob += probAbove(S, grid[i], TF, f) - probAbove(S, grid[i + 1], TF, f);
          }
          popFinal = Math.max(0, Math.min(0.99, prob));
        }
        return { ...st, pl, popFinal };
      });

    return { regime, strategies, em, grid, slopePct };
  }, [und, spot, ivF, ivB, vix, capital, popT]);

  const regimeColor = { LOW: C.vega, NORMAL: C.income, ELEVATED: C.warn, HIGH: C.risk }[out.regime.vol];
  const targetWeekly$ = capital * (yieldT / 100);
  const stratColor = (k: string) => (k === 'dc' || k === 'dd' ? C.vega : C.income);

  return (
    <div className="page-wrap">
      <div style={{ maxWidth: 780, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: C.accent, letterSpacing: '0.2em' }}>WEEKLY INCOME ENGINE</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0', color: C.text, letterSpacing: '-0.02em' }}>SPX / XSP Strategy Selector</h1>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Regime-driven structure selection · Black-Scholes strike & credit estimation · model values, not fills</div>
        </div>

        {/* Inputs */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['SPX', 'XSP'] as const).map((u) => (
              <button key={u} onClick={() => { setUnd(u); setSpot(u === 'XSP' ? Math.round(spot > 1000 ? spot / 10 : spot) : (spot < 1000 ? spot * 10 : spot)); }}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 6, fontFamily: mono, fontSize: 13, cursor: 'pointer',
                  background: und === u ? 'var(--accent)' : 'transparent', color: und === u ? '#fff' : C.dim,
                  border: `1px solid ${und === u ? 'var(--accent)' : C.line}`, fontWeight: 600,
                }}>{u}</button>
            ))}
            <button onClick={fetchLive} disabled={fetching}
              style={{
                flex: 2, padding: '7px 0', borderRadius: 6, fontFamily: mono, fontSize: 12, fontWeight: 600,
                cursor: fetching ? 'wait' : 'pointer', opacity: fetching ? 0.6 : 1,
                background: 'transparent', color: C.vega, border: `1px solid ${C.vega}`,
              }}>
              {fetching ? '⟳ Fetching…' : '⟳ Fetch live data (15-min delayed)'}
            </button>
          </div>
          {fetchMsg && (
            <div style={{
              fontSize: 11, fontFamily: mono, lineHeight: 1.5, marginBottom: 12, padding: '6px 10px', borderRadius: 6,
              color: fetchMsg.ok ? C.income : C.risk,
              background: fetchMsg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${fetchMsg.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}>{fetchMsg.text}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <Field label={`${und} spot`} value={spot} onChange={setSpot} step={und === 'SPX' ? 5 : 1} />
            <Field label="VIX" value={vix} onChange={setVix} step={0.1} />
            <Field label="Front IV (7 DTE)" suffix="%" value={ivF} onChange={setIvF} step={0.1} />
            <Field label="Back IV (14 DTE)" suffix="%" value={ivB} onChange={setIvB} step={0.1} />
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <Slider label="Capital deployed" value={capital} onChange={setCapital} min={2000} max={100000} step={1000} display={fmt$(capital)} />
            <Slider label="Target weekly yield" value={yieldT} onChange={setYieldT} min={0.2} max={2.5} step={0.1} display={yieldT.toFixed(1) + '% · ' + fmt$(targetWeekly$) + '/wk'} />
            <Slider label="Target POP" value={popT} onChange={setPopT} min={55} max={92} step={1} display={popT + '%'} />
          </div>
        </div>

        {/* Regime strip */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: C.faint }}>VOL REGIME</div>
            <div style={{ fontFamily: mono, fontSize: 15, color: regimeColor, fontWeight: 700 }}>{out.regime.vol}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: C.faint }}>TERM STRUCTURE</div>
            <div style={{ fontFamily: mono, fontSize: 15, color: out.regime.structure === 'BACKWARDATION' ? C.vega : C.text }}>
              {out.regime.structure} <span style={{ color: C.dim, fontSize: 12 }}>({out.slopePct >= 0 ? '+' : ''}{out.slopePct.toFixed(1)} pts)</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.1em', color: C.faint }}>1σ EXP. MOVE (7D)</div>
            <div style={{ fontFamily: mono, fontSize: 15, color: C.text }}>±{out.em.toFixed(0)} <span style={{ color: C.dim, fontSize: 12 }}>({fmtPct(out.em / spot)})</span></div>
          </div>
          {vix > 30 && (
            <div style={{ fontFamily: mono, fontSize: 12, color: C.risk, border: `1px solid ${C.risk}`, borderRadius: 6, padding: '4px 8px' }}>
              GOVERNOR: VIX &gt; 30 → halve size or stand down
            </div>
          )}
        </div>

        {/* Strategy cards */}
        {out.strategies.map((st, idx) => {
          const deployed = st.contracts * st.maxRisk;
          const yieldOnCap = capital > 0 ? st.evWeekly / capital : 0;
          const meets = st.evWeekly >= targetWeekly$;
          const standDown = st.score < 42;
          const col = stratColor(st.key);
          return (
            <div key={st.key} style={{
              background: C.panel, border: `1px solid ${idx === 0 ? col : C.line}`, borderRadius: 10,
              padding: 14, marginBottom: 14, opacity: standDown ? 0.55 : 1,
            }}>
              {/* title row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                <div>
                  {idx === 0 && !standDown && <span style={{ fontFamily: mono, fontSize: 10, color: '#fff', background: col, borderRadius: 4, padding: '2px 6px', marginRight: 8, fontWeight: 700 }}>BEST FIT</span>}
                  <span style={{ fontSize: 16, fontWeight: 650, color: C.text }}>{st.name}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: C.dim, marginLeft: 8 }}>{st.dteLabel}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 90, height: 5, background: C.panel2, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${st.score}%`, height: '100%', background: standDown ? C.risk : col }} />
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 12, color: standDown ? C.risk : col }}>fit {st.score}</span>
                </div>
              </div>
              {standDown && <div style={{ fontFamily: mono, fontSize: 11, color: C.risk, marginTop: 6 }}>STAND DOWN — regime doesn't support this structure this week.</div>}

              {/* legs */}
              <div style={{ margin: '10px 0', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
                {st.legs.map((l, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '5px 0', fontFamily: mono, fontSize: 13, borderBottom: i < st.legs.length - 1 ? `1px dashed ${C.line}` : 'none' }}>
                    <span style={{ color: l.side === 'SELL' ? C.income : C.accent, width: 40, fontWeight: 700 }}>{l.side}</span>
                    <span style={{ width: 44, color: C.dim }}>{l.type}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: C.text }}>{l.strike}</span>
                    <span style={{ marginLeft: 'auto', color: C.faint, fontSize: 11 }}>{l.exp}</span>
                  </div>
                ))}
              </div>

              {/* stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
                <Stat label={st.creditDebit.label + ' /ct'} value={fmt$(st.creditDebit.val)} color={st.creditDebit.label === 'Credit' ? C.income : C.text} />
                <Stat label="Max risk /ct" value={fmt$(st.maxRisk)} color={C.risk} />
                <Stat label="POP (model)" value={fmtPct(st.popFinal, 0)} />
                <Stat label="Contracts" value={st.contracts > 0 ? st.contracts + '×' : '0 — use XSP'} color={st.contracts === 0 ? C.warn : C.text} />
                <Stat label="Capital at risk" value={fmt$(deployed)} />
                <Stat label="Est. EV / week" value={`${fmt$(st.evWeekly)} (${fmtPct(yieldOnCap)})`} color={meets ? C.income : C.warn} />
              </div>
              {!meets && !standDown && (
                <div style={{ fontSize: 11, color: C.warn, fontFamily: mono, marginBottom: 8 }}>
                  ▲ Model EV below your {yieldT.toFixed(1)}%/wk target — expected shortfall is the honest answer, not tighter strikes.
                </div>
              )}

              {/* payoff */}
              <div style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 6px 2px', marginBottom: 10 }}>
                <PayoffChart grid={out.grid} pl={st.pl} spot={spot} color={col} />
                <div style={{ fontSize: 9, color: C.faint, fontFamily: mono, padding: '0 4px 4px' }}>P&L per contract at short-leg expiry {st.breakevens ? `· BE ${st.breakevens.map((b) => b.toFixed(0)).join(' / ')}` : '· vega held constant'}</div>
              </div>

              {/* rules */}
              <div style={{ fontSize: 12, lineHeight: 1.55, color: C.dim }}>
                <div><span style={{ color: C.income, fontFamily: mono, fontSize: 11 }}>TP </span>{st.tp}</div>
                <div><span style={{ color: C.risk, fontFamily: mono, fontSize: 11 }}>SL </span>{st.sl}</div>
                <div><span style={{ color: C.warn, fontFamily: mono, fontSize: 11 }}>TIME </span>{st.timeExit}</div>
                <div><span style={{ color: C.accent, fontFamily: mono, fontSize: 11 }}>ENTRY </span>{st.entry}</div>
                <div style={{ marginTop: 6, color: C.faint, fontSize: 11, fontStyle: 'italic' }}>{st.notes}</div>
              </div>
            </div>
          );
        })}

        <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.6, fontFamily: mono }}>
          Model uses Black-Scholes with flat IV per expiry and r = 4%. Credits/debits are mid-price estimates — verify against live chains before sizing.
          Live fetch uses CBOE delayed quotes (~15 min): SPX spot, VIX, and VIX9D as the front-IV proxy.
          Deploy at most ~20–25% of the account's option sleeve per week; the compounding comes from the weeks you don't blow up.
          Not financial advice — a sizing and structure-selection instrument.
        </div>
      </div>
    </div>
  );
}
