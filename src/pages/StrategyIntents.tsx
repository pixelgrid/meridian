import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { blackScholes } from '../lib/blackScholes';

// ── Model constants ────────────────────────────────────────────────────────
// All strategies are modeled on a $100 underlying, base IV 25%, 4% rate.
// Front month = 30 DTE, back month (calendars/diagonals) = 60 DTE.

const SPOT = 100;
const RATE = 0.04;
const BASE_IV = 25; // %

// ── Types ──────────────────────────────────────────────────────────────────

interface SLeg {
  kind: 'call' | 'put';
  side: 1 | -1;
  strike: number;
  dte: number;
  qty?: number;
}

type IntentId = 'theta' | 'highIV' | 'lowIV' | 'neutral' | 'bull' | 'bear' | 'bigmove' | 'range' | 'hedge';
type Bias = 'bullish' | 'bearish' | 'neutral' | 'volatile';

interface Combo { ref: string; note: string }

interface StratDef {
  id: string;
  name: string;
  bias: Bias;
  legs: SLeg[];
  intents: IntentId[];
  summary: string;
  whenToUse: string[];
  risks: string[];
  combos: Combo[];
}

// ── Intentions ─────────────────────────────────────────────────────────────

const INTENTS: { id: IntentId; icon: string; label: string; blurb: string; color: string }[] = [
  { id: 'theta',   icon: '⏳', label: 'Harvest Theta',          color: '#f59e0b', blurb: 'Earn the passage of time — collect premium that decays day after day.' },
  { id: 'highIV',  icon: '📉', label: 'Fade Elevated IV',       color: '#ef4444', blurb: 'IV is pumped (earnings, fear). Sell expensive premium, profit when vol normalizes.' },
  { id: 'lowIV',   icon: '💎', label: 'Own Cheap Volatility',   color: '#8b5cf6', blurb: 'IV is depressed. Buy underpriced optionality that gains if volatility expands.' },
  { id: 'neutral', icon: '⚖️', label: 'Stay Delta-Neutral',     color: '#3b82f6', blurb: 'No directional opinion — profit from time, volatility or range instead of price.' },
  { id: 'bull',    icon: '🐂', label: 'Express a Bullish View', color: '#10b981', blurb: 'You expect the underlying to rise — pick the structure that fits your conviction and IV.' },
  { id: 'bear',    icon: '🐻', label: 'Express a Bearish View', color: '#f43f5e', blurb: 'You expect the underlying to fall — with defined risk or premium collection.' },
  { id: 'bigmove', icon: '💥', label: 'Bet on a Big Move',      color: '#a855f7', blurb: 'You expect an explosive move but are unsure of direction — long-gamma structures.' },
  { id: 'range',   icon: '🎯', label: 'Bet on a Range / Pin',   color: '#06b6d4', blurb: 'You expect the underlying to sit still or gravitate to a level through expiration.' },
  { id: 'hedge',   icon: '🛡️', label: 'Hedge Downside',         color: '#14b8a6', blurb: 'Protect long exposure against a sell-off — insurance structures.' },
];

// ── Strategy catalog ───────────────────────────────────────────────────────

const c = (side: 1 | -1, strike: number, dte = 30, qty = 1): SLeg => ({ kind: 'call', side, strike, dte, qty });
const p = (side: 1 | -1, strike: number, dte = 30, qty = 1): SLeg => ({ kind: 'put', side, strike, dte, qty });

const STRATS: StratDef[] = [
  {
    id: 'longCall', name: 'Long Call', bias: 'bullish',
    legs: [c(1, 100)],
    intents: ['bull', 'lowIV'],
    summary: 'The simplest bullish trade: pay a premium for unlimited upside above the strike. Loss is capped at the debit; you need the stock to move up faster than theta bleeds you.',
    whenToUse: [
      'Strong directional conviction with a catalyst on the calendar',
      'IV is cheap — you are not overpaying for the optionality',
      'You want defined risk instead of holding stock through uncertainty',
    ],
    risks: [
      'Theta decay accelerates into expiration — a flat stock loses money',
      'A rise in the stock can still lose if IV collapses (post-earnings crush)',
      'ATM options need ~a one-standard-deviation move just to break even',
    ],
    combos: [
      { ref: 'bearCallSpread', note: 'sell a higher-strike call against it later to convert into a bull call spread and lock in gains' },
      { ref: 'pmcc', note: 'buy it further out in time and finance it monthly — the diagonal/PMCC pattern' },
    ],
  },
  {
    id: 'longPut', name: 'Long Put', bias: 'bearish',
    legs: [p(1, 100)],
    intents: ['bear', 'hedge', 'lowIV'],
    summary: 'The cleanest bearish or protective trade: gains as the stock falls, capped loss at the premium paid. As a hedge it acts like insurance with a deductible equal to the OTM distance.',
    whenToUse: [
      'Bearish thesis with a defined-risk requirement',
      'Portfolio protection when IV is cheap (buy insurance before the fire)',
      'Ahead of binary events where downside gaps are possible',
    ],
    risks: [
      'Pure theta bleed if the drop never comes',
      'IV crush after feared events hurts even when direction was right',
      'Persistent negative carry when rolled as a permanent hedge',
    ],
    combos: [
      { ref: 'bearPutSpread', note: 'sell a lower put against it to cut the cost when you have a price target' },
      { ref: 'putCalendar', note: 'hedge more cheaply by owning back-month puts and selling front-month decay against them' },
    ],
  },
  {
    id: 'shortPut', name: 'Short Put (Cash-Secured)', bias: 'bullish',
    legs: [p(-1, 95)],
    intents: ['bull', 'theta', 'highIV'],
    summary: 'Sell an OTM put, collect premium, and profit if the stock stays above the strike. Equivalent to being paid to place a limit buy order below the market.',
    whenToUse: [
      'Neutral-to-bullish view on a stock you would happily own lower',
      'Elevated IV inflates the premium you collect',
      'Income generation with a margin of safety below spot',
    ],
    risks: [
      'Loss grows all the way to zero — a crash assigns you stock far above market',
      'Upside is capped at the premium no matter how far the stock rallies',
      'Early assignment risk once the put trades deep ITM',
    ],
    combos: [
      { ref: 'bullPutSpread', note: 'buy a further-OTM put to define the risk — same idea, capped tail' },
      { ref: 'shortStrangle', note: 'add a short OTM call when neutral to double the premium' },
    ],
  },
  {
    id: 'bullCallSpread', name: 'Bull Call Spread', bias: 'bullish',
    legs: [c(1, 100), c(-1, 105)],
    intents: ['bull'],
    summary: 'Buy a call, sell a higher-strike call. The short call finances part of the debit and caps your profit at the spread width — a cheaper, defined bullish bet than a naked call.',
    whenToUse: [
      'Moderately bullish with a realistic price target near the short strike',
      'IV is middling — the short leg offsets the vega you are buying',
      'You want better breakeven than an outright long call',
    ],
    risks: [
      'Profit is capped — a monster rally earns no more than the width',
      'Max loss (the debit) still occurs if the stock stalls below the long strike',
      'Assignment complexity if the short leg goes ITM near expiry',
    ],
    combos: [
      { ref: 'bullPutSpread', note: 'pair with a bull put spread at the same strikes to form a synthetic — or choose the credit version outright when IV is high' },
      { ref: 'callButterfly', note: 'add a second short call and a higher long call to convert into a butterfly around your target' },
    ],
  },
  {
    id: 'bearPutSpread', name: 'Bear Put Spread', bias: 'bearish',
    legs: [p(1, 100), p(-1, 95)],
    intents: ['bear', 'hedge'],
    summary: 'Buy a put, sell a lower-strike put. Defined-risk bearish exposure with the short leg cutting the cost — the standard way to play a measured decline.',
    whenToUse: [
      'Bearish to a specific downside target (place the short strike there)',
      'Hedging a position when outright puts are too expensive',
      'IV already elevated — the short leg offsets the rich vega',
    ],
    risks: [
      'Protection/profit stops at the short strike in a crash',
      'Full debit lost if the stock holds above the long strike',
      'Slow drips may not outrun theta if placed too far OTM',
    ],
    combos: [
      { ref: 'longPut', note: 'skip the short leg when you fear a true crash and want unlimited downside profit' },
      { ref: 'putDiagonal', note: 'push the long put out a month to keep the hedge alive across several front-month cycles' },
    ],
  },
  {
    id: 'bullPutSpread', name: 'Bull Put Credit Spread', bias: 'bullish',
    legs: [p(-1, 95), p(1, 90)],
    intents: ['bull', 'theta', 'highIV'],
    summary: 'Sell an OTM put, buy a further-OTM put. Collect a credit that you keep if the stock stays above the short strike — a defined-risk short put with positive theta.',
    whenToUse: [
      'Neutral-to-bullish view; you only need the stock to not fall',
      'Elevated IV fattens the credit relative to the width',
      'Systematic premium selling with strict risk definition',
    ],
    risks: [
      'Risk/reward is inverted — you often risk 3–4× what you collect',
      'Losses arrive fast once the short strike breaks',
      'Pin risk near the short strike at expiration',
    ],
    combos: [
      { ref: 'bearCallSpread', note: 'add the mirror-image call spread to complete an iron condor' },
      { ref: 'shortPut', note: 'drop the long leg on margin-friendly underlyings you want to own' },
    ],
  },
  {
    id: 'bearCallSpread', name: 'Bear Call Credit Spread', bias: 'bearish',
    legs: [c(-1, 105), c(1, 110)],
    intents: ['bear', 'theta', 'highIV'],
    summary: 'Sell an OTM call, buy a further-OTM call. You keep the credit if the stock stays below the short strike — profiting from drift, chop or decline.',
    whenToUse: [
      'Neutral-to-bearish view; resistance overhead you expect to hold',
      'Post-spike IV you want to fade without unlimited call risk',
      'Complements put spreads in range-bound income books',
    ],
    risks: [
      'Rallies gap through call spreads faster than traders expect',
      'Risk several times the credit received',
      'Short calls face early assignment ahead of dividends',
    ],
    combos: [
      { ref: 'bullPutSpread', note: 'the other wing of an iron condor' },
      { ref: 'longPut', note: 'a bearish pairing: the credit finances the put debit' },
    ],
  },
  {
    id: 'riskReversal', name: 'Risk Reversal (Bullish)', bias: 'bullish',
    legs: [p(-1, 95), c(1, 105)],
    intents: ['bull'],
    summary: 'Sell an OTM put to finance an OTM call — often for zero or negative cost. Synthetic-like bullish exposure: you win big on a rally but take on stock-like downside below the put.',
    whenToUse: [
      'High-conviction bullish view where you accept assignment risk',
      'Put skew is rich: the put you sell is overpriced vs the call you buy',
      'Replacing stock exposure with capital-efficient options',
    ],
    risks: [
      'Downside is essentially long stock from the put strike — not defined risk',
      'The "free" trade dies quietly if the stock sits between the strikes',
      'Margin requirements comparable to a naked put',
    ],
    combos: [
      { ref: 'bullCallSpread', note: 'defined-risk alternative when you cannot wear the naked put' },
      { ref: 'shortPut', note: 'the financing engine on its own, minus the upside kicker' },
    ],
  },
  {
    id: 'longStraddle', name: 'Long Straddle', bias: 'volatile',
    legs: [c(1, 100), p(1, 100)],
    intents: ['bigmove', 'lowIV', 'neutral'],
    summary: 'Buy the ATM call and put together. Direction-agnostic: you profit if the stock moves far enough either way, or if IV expands. The purest long-gamma, long-vega position.',
    whenToUse: [
      'A binary catalyst (earnings, FDA, macro print) with the move underpriced',
      'IV near the bottom of its range — optionality on sale',
      'You expect realized volatility to exceed what the market implies',
    ],
    risks: [
      'Double theta bleed — the most expensive structure to sit on',
      'Needs a move larger than the combined premium to profit at expiry',
      'IV crush after the event can overwhelm a decent move',
    ],
    combos: [
      { ref: 'longStrangle', note: 'move both strikes OTM for a cheaper, wider version' },
      { ref: 'reverseIC', note: 'add short wings to cut cost in exchange for capped profit' },
    ],
  },
  {
    id: 'longStrangle', name: 'Long Strangle', bias: 'volatile',
    legs: [c(1, 105), p(1, 95)],
    intents: ['bigmove', 'lowIV', 'neutral'],
    summary: 'Buy an OTM call and OTM put. Cheaper than a straddle but needs a bigger move — a leveraged bet on an outsized surprise in either direction.',
    whenToUse: [
      'You expect a violent move well beyond the expected range',
      'Lower capital outlay than a straddle matters to you',
      'IV is cheap across the wings',
    ],
    risks: [
      'Both legs can expire worthless even after a decent move',
      'Theta bleed on two OTM options adds up quickly',
      'Very sensitive to IV crush',
    ],
    combos: [
      { ref: 'longStraddle', note: 'pay up for strikes at-the-money when you want more gamma per move' },
      { ref: 'callBackspread', note: 'add directional tilt if you lean one way' },
    ],
  },
  {
    id: 'shortStraddle', name: 'Short Straddle', bias: 'neutral',
    legs: [c(-1, 100), p(-1, 100)],
    intents: ['theta', 'highIV', 'neutral', 'range'],
    summary: 'Sell the ATM call and put. Maximum premium, maximum theta — and unlimited risk both ways. The professional volatility seller\'s core trade, sized very small.',
    whenToUse: [
      'IV is extreme relative to what the stock realistically realizes',
      'Post-event: sell the crush after the news is out',
      'You can actively delta-hedge or manage the position daily',
    ],
    risks: [
      'Unlimited loss in either direction — one gap can erase months of income',
      'Short gamma: losses accelerate as the move extends',
      'Margin expands exactly when the trade hurts',
    ],
    combos: [
      { ref: 'ironButterfly', note: 'buy wings to define the risk — the sane retail version' },
      { ref: 'longStrangle', note: 'own cheap far wings against it to cap the tails ("iron fly by parts")' },
    ],
  },
  {
    id: 'shortStrangle', name: 'Short Strangle', bias: 'neutral',
    legs: [c(-1, 107), p(-1, 93)],
    intents: ['theta', 'highIV', 'neutral', 'range'],
    summary: 'Sell an OTM call and OTM put. Wider profit zone than a short straddle for less premium — the classic high-probability premium harvest with undefined tails.',
    whenToUse: [
      'Range-bound market with inflated IV',
      'You want a high win rate and can tolerate rare large losses',
      'Liquid underlyings where you can roll strikes when tested',
    ],
    risks: [
      'Tail risk is unlimited on both sides',
      'High win rate hides severe loss skew — sizing is everything',
      'Correlated books (many strangles) all break in the same crash',
    ],
    combos: [
      { ref: 'ironCondor', note: 'buy further wings to convert into defined risk' },
      { ref: 'putCalendar', note: 'pair with long-vega calendars to soften a vol spike' },
    ],
  },
  {
    id: 'ironCondor', name: 'Iron Condor', bias: 'neutral',
    legs: [p(1, 88), p(-1, 93), c(-1, 107), c(1, 112)],
    intents: ['theta', 'highIV', 'neutral', 'range'],
    summary: 'A bull put spread plus a bear call spread: collect a credit if the stock stays between the short strikes. Defined risk on both wings — the flagship range-income strategy.',
    whenToUse: [
      'Sideways market with elevated IV (sell the expected range wider than realized)',
      'Systematic monthly income with capped, known risk',
      'You want short-strangle economics without tail exposure',
    ],
    risks: [
      'Risk typically 2–4× the credit — a few losers undo many winners',
      'Short gamma near expiry: late-cycle moves damage fast',
      'Managing the tested side (rolling) adds cost and complexity',
    ],
    combos: [
      { ref: 'doubleCalendar', note: 'swap in when IV is LOW — same range bet but long vega instead of short' },
      { ref: 'ironButterfly', note: 'tighten short strikes to ATM for more credit and a narrower zone' },
    ],
  },
  {
    id: 'ironButterfly', name: 'Iron Butterfly', bias: 'neutral',
    legs: [p(1, 90), p(-1, 100), c(-1, 100), c(1, 110)],
    intents: ['theta', 'highIV', 'neutral', 'range'],
    summary: 'Sell the ATM straddle, buy OTM wings. Large credit, narrow peak at the short strike — a defined-risk short straddle rewarding a pin at the money.',
    whenToUse: [
      'You expect price to gravitate to a level (max pain, big strike)',
      'Very high IV you want to sell hard with capped risk',
      '0DTE/weekly income structures around known ranges',
    ],
    risks: [
      'Needs the stock near the center — the peak is narrow',
      'Almost always tested on one side; management is the norm',
      'Wing width defines a real, frequently-hit max loss',
    ],
    combos: [
      { ref: 'ironCondor', note: 'push the short strikes apart for probability over premium' },
      { ref: 'callButterfly', note: 'the debit twin — near-identical payoff built from calls only' },
    ],
  },
  {
    id: 'callButterfly', name: 'Long Call Butterfly', bias: 'neutral',
    legs: [c(1, 95), c(-1, 100, 30, 2), c(1, 105)],
    intents: ['range', 'neutral', 'theta'],
    summary: 'Buy one call below, sell two at the target, buy one above. Tiny debit, big payoff if the stock pins the middle strike at expiry — a cheap lottery ticket on a specific level.',
    whenToUse: [
      'Strong pin thesis at a specific price into expiration',
      'You want range exposure for pennies (great risk/reward ratio)',
      'Low IV environments where the fly is cheap to own',
    ],
    risks: [
      'Very low probability of the maximum payoff — the tent is narrow',
      'Profit only materializes near expiry; marks barely move early on',
      'Three legs of slippage on a small-premium trade',
    ],
    combos: [
      { ref: 'ironButterfly', note: 'the credit-built equivalent with identical shape' },
      { ref: 'callCalendar', note: 'the time-spread cousin — same pin bet, but long vega' },
    ],
  },
  {
    id: 'reverseIC', name: 'Reverse Iron Condor', bias: 'volatile',
    legs: [p(-1, 88), p(1, 93), c(1, 107), c(-1, 112)],
    intents: ['bigmove'],
    summary: 'Buy a put spread below and a call spread above (pay a debit). Profits if the stock escapes the range in either direction — a defined-cost strangle with capped payoff.',
    whenToUse: [
      'Expecting a breakout from consolidation, direction unknown',
      'Cheaper than a strangle; both risk and reward strictly defined',
      'Event plays where you want to cap the cost of being wrong',
    ],
    risks: [
      'Loses the full debit if the stock stays inside the wings',
      'Payoff capped at wing width — huge moves earn no extra',
      'Needs the move before front-month theta erodes the spreads',
    ],
    combos: [
      { ref: 'longStrangle', note: 'uncapped version when you expect a truly massive move' },
      { ref: 'callBackspread', note: 'directional alternative if you lean one way' },
    ],
  },
  {
    id: 'callBackspread', name: 'Call Ratio Backspread', bias: 'volatile',
    legs: [c(-1, 100), c(1, 105, 30, 2)],
    intents: ['bull', 'bigmove', 'lowIV'],
    summary: 'Sell one call, buy two higher calls — often for near-zero cost. Small loss zone in the middle, unlimited profit on a melt-up, flat-to-positive if the stock collapses.',
    whenToUse: [
      'Explosively bullish: you want convexity, not a capped spread',
      'Cheap upside IV (call skew) makes the 2× long legs affordable',
      'You want "crash-safe" bullish exposure (down big ≈ break even)',
    ],
    risks: [
      'Maximum loss lands exactly at the long strikes at expiry — a slow drift up is the worst case',
      'Negative theta pocket in the valley between strikes',
      'Ratio positions surprise on margin and assignment',
    ],
    combos: [
      { ref: 'putBackspread', note: 'the bearish mirror image' },
      { ref: 'longCall', note: 'simpler when cost is acceptable and you want no valley' },
    ],
  },
  {
    id: 'putBackspread', name: 'Put Ratio Backspread', bias: 'volatile',
    legs: [p(-1, 100), p(1, 95, 30, 2)],
    intents: ['bear', 'bigmove', 'hedge'],
    summary: 'Sell one put, buy two lower puts. Cheap crash insurance: explodes in value on a large decline, roughly flat on a rally, with the loss pocket on a mild dip.',
    whenToUse: [
      'You fear a crash, not a drift lower',
      'Tail hedging when outright puts are too expensive to hold',
      'Put skew steepness makes the structure near-costless',
    ],
    risks: [
      'A mild decline to the long strikes at expiry is maximum pain',
      'Theta bleed in the valley while you wait for the crash',
      'Hedged books can still lose on slow grinds down',
    ],
    combos: [
      { ref: 'callBackspread', note: 'the bullish mirror image' },
      { ref: 'bearPutSpread', note: 'better for measured declines to a target' },
    ],
  },
  {
    id: 'callCalendar', name: 'Call Calendar Spread', bias: 'neutral',
    legs: [c(-1, 100, 30), c(1, 100, 60)],
    intents: ['theta', 'lowIV', 'neutral', 'range'],
    summary: 'Sell the front-month call, buy the back-month call at the same strike. Harvests the faster decay of the near option while staying long vega through the back month.',
    whenToUse: [
      'Pin thesis at the strike through front expiration',
      'Low IV you expect to rise (long vega) while still collecting theta',
      'Front-month IV elevated vs back (event in the front cycle)',
    ],
    risks: [
      'Large moves in either direction collapse the time-value differential',
      'IV crush in the back month hurts more than front theta helps',
      'Short front leg needs management as expiration approaches',
    ],
    combos: [
      { ref: 'doubleCalendar', note: 'add a put calendar at a lower strike to widen the zone' },
      { ref: 'pmcc', note: 'tilt bullish by dropping the long strike ITM' },
    ],
  },
  {
    id: 'putCalendar', name: 'Put Calendar Spread', bias: 'neutral',
    legs: [p(-1, 100, 30), p(1, 100, 60)],
    intents: ['theta', 'lowIV', 'neutral', 'range'],
    summary: 'Same mechanics as the call calendar, built with puts. Often slightly cheaper due to skew, and pairs naturally with hedging programs (the long back-month put has residual protective value).',
    whenToUse: [
      'Identical setups to the call calendar — pick puts when their pricing is favorable',
      'You want the leftover back-month put as a mini-hedge after front expiry',
      'Slightly bearish-leaning pin plays',
    ],
    risks: [
      'Same as the call calendar: big moves and back-month vol crush',
      'Early assignment on the short put if it goes ITM (dividends aside, less common but real)',
      'Skew can make rolling costlier on the put side',
    ],
    combos: [
      { ref: 'doubleCalendar', note: 'the standard pairing with a call calendar above' },
      { ref: 'shortStrangle', note: 'vega-balancing partner: strangle is short vega, calendar long' },
    ],
  },
  {
    id: 'pmcc', name: "Call Diagonal (Poor Man's Covered Call)", bias: 'bullish',
    legs: [c(1, 85, 60), c(-1, 105, 30)],
    intents: ['bull', 'theta'],
    summary: 'Buy a deep-ITM back-month call as a stock substitute, sell OTM front-month calls against it repeatedly. Covered-call income at a fraction of the capital.',
    whenToUse: [
      'Bullish over months, happy to earn income while you wait',
      'You want covered-call economics without buying 100 shares',
      'The long call\'s delta ≈ 0.8+ makes it a true stock proxy',
    ],
    risks: [
      'A fast rally through the short strike caps the month and forces a roll',
      'A hard sell-off devalues the long call — it is still an option, not stock',
      'Mispriced rolls can slowly grind away the position\'s edge',
    ],
    combos: [
      { ref: 'callCalendar', note: 'the neutral cousin with both strikes at-the-money' },
      { ref: 'bullPutSpread', note: 'add short put spreads for extra income when confident' },
    ],
  },
  {
    id: 'putDiagonal', name: 'Put Diagonal Spread', bias: 'bearish',
    legs: [p(1, 110, 60), p(-1, 95, 30)],
    intents: ['bear', 'theta', 'hedge'],
    summary: 'Buy an ITM back-month put, sell OTM front-month puts against it. A bearish or hedging engine that pays you theta while holding durable downside protection.',
    whenToUse: [
      'Bearish over a multi-month horizon, not just one cycle',
      'Hedging a portfolio while offsetting the insurance cost monthly',
      'Put skew makes front-month sales rich against back-month buys',
    ],
    risks: [
      'A crash through the short strike caps that month\'s protection at the spread width',
      'A rally erodes the long put faster than short-put income accrues',
      'Two expirations to manage; rolls decide the P&L',
    ],
    combos: [
      { ref: 'pmcc', note: 'the bullish mirror image' },
      { ref: 'bearPutSpread', note: 'single-cycle version for a one-shot decline' },
    ],
  },
  {
    id: 'doubleCalendar', name: 'Double Calendar', bias: 'neutral',
    legs: [p(-1, 95, 30), p(1, 95, 60), c(-1, 105, 30), c(1, 105, 60)],
    intents: ['theta', 'lowIV', 'neutral', 'range'],
    summary: 'A put calendar below the market plus a call calendar above it. Twin peaks create a wide profit plateau — a range bet that is long vega instead of short.',
    whenToUse: [
      'Range-bound thesis but no confidence in a single pin price',
      'Low IV where iron condors pay too little and vega risk is asymmetric',
      'Pre-event: front IV pumped vs back month (sell the pumped month)',
    ],
    risks: [
      'Gap moves beyond the strikes lose the debit quickly',
      'Back-month IV crush deflates both long legs at once',
      'Four legs across two expirations — slippage and management overhead',
    ],
    combos: [
      { ref: 'ironCondor', note: 'the short-vega twin — switch between them based on IV level' },
      { ref: 'doubleDiagonal', note: 'move the long strikes wider for more theta and a flatter plateau' },
    ],
  },
  {
    id: 'doubleDiagonal', name: 'Double Diagonal', bias: 'neutral',
    legs: [p(-1, 95, 30), p(1, 90, 60), c(-1, 105, 30), c(1, 110, 60)],
    intents: ['theta', 'lowIV', 'neutral', 'range'],
    summary: 'A double calendar whose long back-month legs sit further OTM. Cheaper entry, wider and flatter profit zone, embedded short verticals — condor-like income with positive vega.',
    whenToUse: [
      'You would sell an iron condor but want protection if IV spikes',
      'Wide-range thesis with maximum theta from the family',
      'Moderate IV: too low to sell condors happily, too high to buy straddles',
    ],
    risks: [
      'Max loss is wing width ± debit — wider than a double calendar\'s',
      'Assignment risk on two short front-month legs',
      'Complex greeks: exposure flips as price approaches either wing',
    ],
    combos: [
      { ref: 'doubleCalendar', note: 'tighter, purer time-spread version' },
      { ref: 'ironCondor', note: 'its short-vega counterpart — some traders run both and trade the vega spread' },
    ],
  },
];

// ── Pricing ────────────────────────────────────────────────────────────────

function frontDte(legs: SLeg[]): number {
  return Math.min(...legs.map(l => l.dte));
}

// Value of one unit of a leg. Front-expiring legs use the slider IV; back-month
// legs stay at BASE_IV (per the "IV applies to the front expiry" convention).
function legVal(leg: SLeg, S: number, day: number, frontIvPct: number, minDte: number): number {
  const T = (leg.dte - day) / 365;
  if (T <= 0) return leg.kind === 'call' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  const ivPct = leg.dte === minDte ? frontIvPct : BASE_IV;
  const bs = blackScholes({ S, K: leg.strike, T, r: RATE, sigma: Math.max(0.01, ivPct / 100) });
  return leg.kind === 'call' ? bs.call : bs.put;
}

// Position value in dollars (×100)
function posValue(legs: SLeg[], S: number, day: number, frontIvPct: number): number {
  const minDte = frontDte(legs);
  return legs.reduce((s, l) => s + l.side * (l.qty ?? 1) * legVal(l, S, day, frontIvPct, minDte) * 100, 0);
}

// Entry cost, always at BASE_IV, day 0
function entryCost(legs: SLeg[]): number {
  return posValue(legs, SPOT, 0, BASE_IV);
}

interface StratStats {
  cost: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
}

function stratStats(legs: SLeg[]): StratStats {
  const cost = entryCost(legs);
  const minDte = frontDte(legs);
  const pnlAt = (S: number) => posValue(legs, S, minDte, BASE_IV) - cost;
  const netCalls = legs.filter(l => l.kind === 'call').reduce((s, l) => s + l.side * (l.qty ?? 1), 0);
  let maxProfit = -Infinity, maxLoss = Infinity;
  const breakevens: number[] = [];
  let prev = pnlAt(1), prevS = 1;
  for (let i = 1; i <= 400; i++) {
    const S = 1 + (SPOT * 2.5 - 1) * (i / 400);
    const v = pnlAt(S);
    maxProfit = Math.max(maxProfit, v);
    maxLoss = Math.min(maxLoss, v);
    if ((prev < 0 && v >= 0) || (prev >= 0 && v < 0)) {
      breakevens.push(prevS + (prev / (prev - v)) * (S - prevS));
    }
    prev = v; prevS = S;
  }
  if (netCalls > 0) maxProfit = Infinity;
  if (netCalls < 0) maxLoss = -Infinity;
  return { cost, maxProfit, maxLoss, breakevens };
}

function fmtMoney(v: number): string {
  if (!isFinite(v)) return 'Unlimited';
  return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(0)}`;
}

// ── Bias badge ─────────────────────────────────────────────────────────────

const BIAS_CFG: Record<Bias, { label: string; color: string }> = {
  bullish: { label: 'BULLISH', color: '#10b981' },
  bearish: { label: 'BEARISH', color: '#ef4444' },
  neutral: { label: 'NEUTRAL', color: '#3b82f6' },
  volatile: { label: 'VOLATILE', color: '#8b5cf6' },
};

function BiasBadge({ bias }: { bias: Bias }) {
  const cfg = BIAS_CFG[bias];
  return (
    <span style={{
      background: cfg.color + '18', border: `1px solid ${cfg.color}50`, color: cfg.color,
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 20,
    }}>{cfg.label}</span>
  );
}

// ── Payoff sparkline (SVG) ─────────────────────────────────────────────────

function PayoffSpark({ legs }: { legs: SLeg[] }) {
  const W = 260, H = 72;
  const path = useMemo(() => {
    const cost = entryCost(legs);
    const minDte = frontDte(legs);
    const lo = SPOT * 0.78, hi = SPOT * 1.22, N = 60;
    const vals: number[] = [];
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * (i / N);
      vals.push(posValue(legs, S, minDte, BASE_IV) - cost);
    }
    const vMax = Math.max(...vals.map(Math.abs), 1);
    const y = (v: number) => H / 2 - (v / vMax) * (H / 2 - 6);
    const x = (i: number) => (i / N) * W;
    const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${W},${H / 2} L0,${H / 2} Z`;
    return { line, area };
  }, [legs]);

  const zeroY = H / 2;
  const uid = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <defs>
        <clipPath id={`up-${uid}`}><rect x="0" y="0" width={W} height={zeroY} /></clipPath>
        <clipPath id={`dn-${uid}`}><rect x="0" y={zeroY} width={W} height={H - zeroY} /></clipPath>
      </defs>
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
      <path d={path.area} fill="rgba(16,185,129,0.22)" clipPath={`url(#up-${uid})`} />
      <path d={path.area} fill="rgba(239,68,68,0.22)" clipPath={`url(#dn-${uid})`} />
      <path d={path.line} fill="none" stroke="#818cf8" strokeWidth="2" />
    </svg>
  );
}

// ── Greek exposure panel ───────────────────────────────────────────────────

const GREEK_EXPLAIN: Record<string, Record<string, string>> = {
  delta: {
    long: 'Gains as the underlying rises — you carry directional upside exposure.',
    short: 'Gains as the underlying falls — you carry directional downside exposure.',
    flat: 'Little directional exposure at the current price — moves alone barely change P/L.',
  },
  gamma: {
    long: 'Delta bends in your favor on big moves: rallies make you longer, sell-offs make you shorter. Big moves help.',
    short: 'Delta bends against you on big moves — the faster the market moves, the faster losses grow. You want quiet tape.',
    flat: 'Delta is stable — the position behaves linearly for moderate moves.',
  },
  theta: {
    long: 'Earns money every day that passes, all else equal — time is your ally.',
    short: 'Bleeds value daily — the expected move must happen before decay eats the premium.',
    flat: 'Time decay roughly nets out across the legs right now.',
  },
  vega: {
    long: 'Profits if implied volatility rises; an IV crush hurts.',
    short: 'Profits if implied volatility falls (IV crush is your friend); a vol spike hurts.',
    flat: 'Roughly insulated from IV changes at this moment.',
  },
};

function exposure(v: number, flatBand: number): 'long' | 'short' | 'flat' {
  if (v > flatBand) return 'long';
  if (v < -flatBand) return 'short';
  return 'flat';
}

function GreekBox({ name, value, unit, flatBand }: { name: string; value: number; unit: string; flatBand: number }) {
  const exp = exposure(value, flatBand);
  const color = exp === 'long' ? '#10b981' : exp === 'short' ? '#ef4444' : '#8896aa';
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ color: 'var(--text-h)', fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{name}</span>
        <span style={{
          background: color + '18', border: `1px solid ${color}50`, color,
          fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 20,
        }}>{exp.toUpperCase()}</span>
      </div>
      <div style={{ color, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        {value >= 0 ? '+' : ''}{value.toFixed(name === 'gamma' ? 2 : 1)} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{unit}</span>
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>{GREEK_EXPLAIN[name][exp]}</div>
    </div>
  );
}

// ── Detail modal ───────────────────────────────────────────────────────────

function StratDetail({ strat, onClose, onOpen }: {
  strat: StratDef; onClose: () => void; onOpen: (id: string) => void;
}) {
  const minDte = frontDte(strat.legs);
  const hasBackMonth = strat.legs.some(l => l.dte !== minDte);
  const [day, setDay] = useState(0);
  const [frontIv, setFrontIv] = useState(BASE_IV);

  useEffect(() => { setDay(0); setFrontIv(BASE_IV); }, [strat.id]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const stats = useMemo(() => stratStats(strat.legs), [strat.legs]);

  const chartData = useMemo(() => {
    const lo = SPOT * 0.78, hi = SPOT * 1.22, N = 100;
    const rows = [];
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * (i / N);
      const exp = posValue(strat.legs, S, minDte, frontIv) - stats.cost;
      const now = posValue(strat.legs, S, Math.min(day, minDte), frontIv) - stats.cost;
      rows.push({
        price: +S.toFixed(1),
        expiry: +exp.toFixed(1),
        now: +now.toFixed(1),
        profit: exp >= 0 ? +exp.toFixed(1) : null,
        loss: exp < 0 ? +exp.toFixed(1) : null,
      });
    }
    return rows;
  }, [strat.legs, minDte, day, frontIv, stats.cost]);

  const greeks = useMemo(() => {
    const tot = { delta: 0, gamma: 0, theta: 0, vega: 0 };
    for (const l of strat.legs) {
      const T = Math.max(l.dte - Math.min(day, minDte - 0.5), 0.5) / 365;
      const ivPct = l.dte === minDte ? frontIv : BASE_IV;
      const bs = blackScholes({ S: SPOT, K: l.strike, T, r: RATE, sigma: Math.max(0.01, ivPct / 100) });
      const m = l.side * (l.qty ?? 1) * 100;
      tot.delta += (l.kind === 'call' ? bs.delta_call : bs.delta_put) * m;
      tot.gamma += bs.gamma * m;
      tot.theta += (l.kind === 'call' ? bs.theta_call : bs.theta_put) * m;
      tot.vega += bs.vega * m;
    }
    return tot;
  }, [strat.legs, day, frontIv, minDte]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14,
        maxWidth: 880, width: '100%', padding: '24px 28px', margin: 'auto 0',
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-h)', flex: 1 }}>{strat.name}</h2>
          <BiasBadge bias={strat.bias} />
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
            width: 30, height: 30, borderRadius: 8, cursor: 'pointer', fontSize: 15, flexShrink: 0,
          }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {strat.intents.map(id => {
            const it = INTENTS.find(x => x.id === id)!;
            return (
              <span key={id} style={{
                background: it.color + '14', border: `1px solid ${it.color}40`, color: it.color,
                fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
              }}>{it.icon} {it.label}</span>
            );
          })}
        </div>
        <p style={{ margin: '0 0 18px', color: 'var(--text)', fontSize: 13.5, lineHeight: 1.7 }}>{strat.summary}</p>

        {/* Setup + metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginBottom: 18 }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>
              SETUP (UNDERLYING AT $100 · FRONT {minDte}D{hasBackMonth ? ' / BACK 60D' : ''})
            </div>
            {strat.legs.map((l, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6,
              }}>
                <span style={{ color: l.side === 1 ? '#10b981' : '#ef4444', fontWeight: 700, fontSize: 11, width: 36, flexShrink: 0 }}>
                  {l.side === 1 ? 'BUY' : 'SELL'}
                </span>
                <span style={{ color: 'var(--text)', fontSize: 13 }}>
                  {(l.qty ?? 1) > 1 ? `${l.qty}× ` : ''}${l.strike} {l.kind.toUpperCase()} · {l.dte} DTE
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
                  {l.dte === minDte ? 'front' : 'back'} month
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
            {[
              { label: stats.cost >= 0 ? 'NET DEBIT' : 'NET CREDIT', v: fmtMoney(Math.abs(stats.cost)), c: stats.cost >= 0 ? '#f59e0b' : '#10b981' },
              { label: 'MAX PROFIT', v: fmtMoney(stats.maxProfit), c: '#10b981' },
              { label: 'MAX LOSS', v: fmtMoney(stats.maxLoss), c: '#ef4444' },
              { label: 'BREAKEVEN', v: stats.breakevens.length ? stats.breakevens.map(b => `$${b.toFixed(1)}`).join(' / ') : '—', c: '#a5b4fc' },
            ].map(m => (
              <div key={m.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 3 }}>{m.label}</div>
                <div style={{ color: m.c, fontSize: 16, fontWeight: 700 }}>{m.v}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.5 }}>
              Measured at front expiration{hasBackMonth ? ' (back-month legs re-priced with Black-Scholes at 25% IV)' : ''}.
            </div>
          </div>
        </div>

        {/* Interactive: sliders + chart */}
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text)', fontSize: 12 }}>Days passed (of {minDte})</span>
                <span style={{ color: '#818cf8', fontWeight: 700, fontSize: 12 }}>T+{Math.min(day, minDte)}</span>
              </div>
              <input type="range" min={0} max={minDte} step={1} value={Math.min(day, minDte)}
                onChange={e => setDay(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#6366f1' }} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text)', fontSize: 12 }}>
                  {hasBackMonth ? 'Front-month IV' : 'Implied volatility'}
                </span>
                <span style={{ color: '#818cf8', fontWeight: 700, fontSize: 12 }}>{frontIv}%{hasBackMonth ? ' (back fixed 25%)' : ''}</span>
              </div>
              <input type="range" min={8} max={80} step={1} value={frontIv}
                onChange={e => setFrontIv(parseInt(e.target.value))} style={{ width: '100%', accentColor: '#6366f1' }} />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="price" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false}
                axisLine={{ stroke: 'var(--border)' }} tickFormatter={v => `$${v}`} interval={19} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={v => `$${v}`} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-h)' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : 0;
                  return [
                    <span style={{ color: v >= 0 ? '#10b981' : '#ef4444' }}>{v >= 0 ? '+' : ''}${v.toFixed(0)}</span>,
                    name === 'expiry' ? 'At front expiration' : `T+${Math.min(day, minDte)}`,
                  ];
                }}
                labelFormatter={l => `Underlying: $${l}`} />
              <Legend formatter={(v: string) => v === 'expiry' ? 'At front expiration' : `T+${Math.min(day, minDte)} (current)`}
                wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#3b4060" strokeWidth={1.5} />
              <ReferenceLine x={SPOT} stroke="#8896aa" strokeWidth={1} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="profit" fill="rgba(16,185,129,0.10)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Area type="monotone" dataKey="loss" fill="rgba(239,68,68,0.10)" stroke="none" connectNulls={false} isAnimationActive={false} legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="expiry" stroke="#6366f1" strokeWidth={2.2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="now" stroke="#f59e0b" strokeWidth={1.8} strokeDasharray="6 3" dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Greeks */}
        <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>
          GREEK EXPOSURE (AT $100, T+{Math.min(day, minDte)}, {hasBackMonth ? `FRONT IV ${frontIv}%` : `IV ${frontIv}%`})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 18 }}>
          <GreekBox name="delta" value={greeks.delta} unit="share-equiv" flatBand={8} />
          <GreekBox name="gamma" value={greeks.gamma} unit="Δ per $1 move" flatBand={0.5} />
          <GreekBox name="theta" value={greeks.theta} unit="$ / day" flatBand={0.5} />
          <GreekBox name="vega" value={greeks.vega} unit="$ / IV pt" flatBand={1} />
        </div>

        {/* When to use / risks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginBottom: 18 }}>
          <div>
            <div style={{ color: '#10b981', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>✓ WHEN TO USE</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.8 }}>
              {strat.whenToUse.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
          <div>
            <div style={{ color: '#ef4444', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>⚠ RISKS</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.8 }}>
              {strat.risks.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        </div>

        {/* Combos */}
        <div style={{ background: '#6366f10c', border: '1px solid #6366f130', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ color: '#a5b4fc', fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', marginBottom: 8 }}>🔗 COMBINES WELL WITH</div>
          {strat.combos.map((cb, i) => {
            const target = STRATS.find(s => s.id === cb.ref);
            return (
              <div key={i} style={{ color: 'var(--text)', fontSize: 12.5, lineHeight: 1.7, marginBottom: 4 }}>
                <button onClick={() => onOpen(cb.ref)} style={{
                  background: 'none', border: 'none', color: '#818cf8', fontWeight: 700, fontSize: 12.5,
                  cursor: 'pointer', padding: 0, textDecoration: 'underline',
                }}>{target?.name ?? cb.ref}</button>
                {' — '}{cb.note}
              </div>
            );
          })}
        </div>

        <Link to="/strategy-builder" style={{ color: '#818cf8', fontSize: 12.5, fontWeight: 600 }}>
          Rebuild this leg-by-leg in the Strategy Builder →
        </Link>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function StrategyIntents() {
  const [intent, setIntent] = useState<IntentId>('theta');
  const [openId, setOpenId] = useState<string | null>(null);

  const active = INTENTS.find(i => i.id === intent)!;
  const matches = useMemo(() => STRATS.filter(s => s.intents.includes(intent)), [intent]);
  const openStrat = openId ? STRATS.find(s => s.id === openId) ?? null : null;

  return (
    <div className="page-wrap">
      <h1 style={{ margin: '0 0 6px', fontSize: 32, fontWeight: 700, color: 'var(--text-h)', letterSpacing: '-0.02em' }}>
        Strategies by Intention
      </h1>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.7, maxWidth: 780 }}>
        Options strategies are answers — start with the question. Pick what you are trying to achieve and see every
        structure built for that goal, with live payoff curves and greek exposure. Click any strategy for the full
        interactive breakdown.
      </p>

      {/* Intent selector */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: 10, marginBottom: 26 }}>
        {INTENTS.map(it => {
          const activeCard = it.id === intent;
          return (
            <button key={it.id} onClick={() => setIntent(it.id)} style={{
              textAlign: 'left', background: activeCard ? it.color + '14' : 'var(--bg-card)',
              border: `1px solid ${activeCard ? it.color : 'var(--border)'}`,
              borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'all 0.12s',
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: activeCard ? it.color : 'var(--text-h)', marginBottom: 4 }}>
                {it.icon} {it.label}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.5 }}>{it.blurb}</div>
            </button>
          );
        })}
      </div>

      {/* Result header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 4, height: 22, borderRadius: 2, background: active.color }} />
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: 'var(--text-h)' }}>
          {active.icon} {active.label} — {matches.length} strategies
        </h2>
      </div>

      {/* Strategy cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: 12, marginBottom: 36 }}>
        {matches.map(s => {
          const stats = stratStats(s.legs);
          return (
            <button key={s.id} onClick={() => setOpenId(s.id)} style={{
              textAlign: 'left', background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.12s',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = active.color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-h)', fontSize: 14, fontWeight: 700 }}>{s.name}</span>
                <BiasBadge bias={s.bias} />
              </div>
              <PayoffSpark legs={s.legs} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
                <span style={{ color: stats.cost >= 0 ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                  {stats.cost >= 0 ? 'debit' : 'credit'} ${Math.abs(stats.cost).toFixed(0)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  max {isFinite(stats.maxProfit) ? `+$${stats.maxProfit.toFixed(0)}` : '∞'} / {isFinite(stats.maxLoss) ? `-$${Math.abs(stats.maxLoss).toFixed(0)}` : '∞'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Playbook: combining intentions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 4, height: 22, borderRadius: 2, background: '#8b5cf6' }} />
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: 'var(--text-h)' }}>Playbook: Combining Intentions</h2>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 36 }}>
        {[
          {
            t: 'Balance your vega book', c: '#8b5cf6',
            b: 'Short-vega income (iron condors, strangles) pairs naturally with long-vega time spreads (calendars, double diagonals). Run both and a vol spike that hurts one side helps the other — you are trading richness between months instead of betting on one vol direction.',
          },
          {
            t: 'The Wheel: intent chaining', c: '#10b981',
            b: 'Sell cash-secured puts (harvest theta + bullish) until assigned, then sell covered calls on the stock until called away. Each stage is a different intention using the same premium-selling engine.',
          },
          {
            t: 'Earnings: sell the front, own the back', c: '#f59e0b',
            b: 'Before earnings, front-month IV inflates far above back-month. Double calendars and diagonals sell the pumped month and own the calm one — long vega where it is cheap, short where it is dear.',
          },
          {
            t: 'Finance your hedges', c: '#14b8a6',
            b: 'Pure protection bleeds. Put diagonals and collar-style structures pay for downside insurance by selling premium elsewhere — trading some upside or theta for a durable hedge you can actually hold.',
          },
          {
            t: 'Convexity + income', c: '#3b82f6',
            b: 'A small allocation to backspreads or long strangles (bet on a big move) offsets the short-gamma profile of an income book. Losers most months, but they print exactly when your condors are breaking.',
          },
          {
            t: 'Repair, don\'t hope', c: '#ef4444',
            b: 'Strategies convert into each other: a losing long call becomes a spread by selling a higher strike; a tested short put rolls into a strangle; a straddle legs into a butterfly. Knowing the map lets you adjust instead of bailing.',
          },
        ].map(x => (
          <div key={x.t} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: x.c, flexShrink: 0 }} />
              <div style={{ color: 'var(--text-h)', fontWeight: 700, fontSize: 13 }}>{x.t}</div>
            </div>
            <div style={{ color: 'var(--text)', fontSize: 12.5, lineHeight: 1.65 }}>{x.b}</div>
          </div>
        ))}
      </div>

      {/* How to read the greeks */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 4, height: 22, borderRadius: 2, background: '#3b82f6' }} />
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: 'var(--text-h)' }}>Reading the Greek Badges</h2>
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 14, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.65 }}>
          <div><strong style={{ color: '#818cf8' }}>Delta</strong> — direction. Long delta wins when price rises, short delta when it falls. Measured in share-equivalents: +50 behaves like owning 50 shares.</div>
          <div><strong style={{ color: '#818cf8' }}>Gamma</strong> — acceleration. Long gamma means moves help you increasingly; short gamma means they hurt increasingly. Premium sellers are short gamma — that is what they are paid for.</div>
          <div><strong style={{ color: '#818cf8' }}>Theta</strong> — time. Positive theta earns daily as options decay; negative theta pays daily rent for optionality. Theta and gamma are two sides of the same coin.</div>
          <div><strong style={{ color: '#818cf8' }}>Vega</strong> — volatility. Long vega profits when IV rises (buy fear cheap, sell it dear); short vega profits when IV falls. The IV slider in each strategy shows exactly this sensitivity.</div>
        </div>
      </div>

      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
        All figures are Black-Scholes model values on a $100 underlying (base IV 25%, 4% rate, front month 30 DTE,
        back month 60 DTE, no dividends, no skew). For calendars and diagonals, the IV slider moves the front-expiring
        legs only. Educational content — not investment advice.
      </p>

      {openStrat && (
        <StratDetail strat={openStrat} onClose={() => setOpenId(null)} onOpen={id => setOpenId(id)} />
      )}
    </div>
  );
}
