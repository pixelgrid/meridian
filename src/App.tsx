import { HashRouter, Routes, Route } from 'react-router-dom';
import { Nav } from './components/Nav';
import { Strategies } from './pages/Strategies';
import { Glossary } from './pages/Glossary';
import { Greeks } from './pages/Greeks';
import { Pricing } from './pages/Pricing';
import { Volatility } from './pages/Volatility';
import { OptionsChain } from './pages/OptionsChain';
import { Lifecycle } from './pages/Lifecycle';
import { Earnings } from './pages/Earnings';
import { Wheel } from './pages/Wheel';
import { RiskManagement } from './pages/RiskManagement';
import { Mistakes } from './pages/Mistakes';
import { VRP } from './pages/VRP';
import { DTE45 } from './pages/DTE45';
import { VIXRegime } from './pages/VIXRegime';
import { Dispersion } from './pages/Dispersion';
import { GammaScalping } from './pages/GammaScalping';
import { PutWrite } from './pages/PutWrite';
import { PMCC } from './pages/PMCC';
import { FinancialStatements } from './pages/FinancialStatements';
import { EarningsSurprises } from './pages/EarningsSurprises';
import { ValuationSnapshot } from './pages/ValuationSnapshot';
import { DCFCalculator } from './pages/DCFCalculator';
import { DividendSafety } from './pages/DividendSafety';
import { Landing } from './pages/Landing';
import { NewsSentiment } from './pages/NewsSentiment';
import { ZeroCostCollar } from './pages/ZeroCostCollar';
import { StocksGlossary } from './pages/StocksGlossary';
import { ResearchFramework } from './pages/ResearchFramework';
import { BondBasics } from './pages/BondBasics';
import { BondPricing } from './pages/BondPricing';
import { YieldCurve } from './pages/YieldCurve';
import { CreditAnalysis } from './pages/CreditAnalysis';
import { BondStrategies } from './pages/BondStrategies';
import { RelativeValue } from './pages/RelativeValue';
import { BondMacro } from './pages/BondMacro';
import { BondGlossary } from './pages/BondGlossary';
import { TradrSignals } from './pages/TradrSignals';
import { ArbitrageAtlas } from './pages/ArbitrageAtlas';
import { MEIC as MEICPage } from './pages/MEIC';
import { CalendarSpreads } from './pages/CalendarSpreads';
import { StrategyBuilder } from './pages/StrategyBuilder';
import { StrategyIntents } from './pages/StrategyIntents';
import { SPXIncomeEngine } from './pages/SPXIncomeEngine';
import { RatioSpreads } from './pages/RatioSpreads';

export default function App() {
  return (
    <HashRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/strategies" element={<Strategies />} />
        <Route path="/glossary" element={<Glossary />} />
        <Route path="/greeks" element={<Greeks />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/volatility" element={<Volatility />} />
        <Route path="/options-chain" element={<OptionsChain />} />
        <Route path="/lifecycle" element={<Lifecycle />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/wheel" element={<Wheel />} />
        <Route path="/risk" element={<RiskManagement />} />
        <Route path="/mistakes" element={<Mistakes />} />
        <Route path="/vrp" element={<VRP />} />
        <Route path="/dte45" element={<DTE45 />} />
        <Route path="/vix-regime" element={<VIXRegime />} />
        <Route path="/dispersion" element={<Dispersion />} />
        <Route path="/gamma-scalping" element={<GammaScalping />} />
        <Route path="/put-write" element={<PutWrite />} />
        <Route path="/pmcc" element={<PMCC />} />
        <Route path="/financials" element={<FinancialStatements />} />
        <Route path="/earnings-history" element={<EarningsSurprises />} />
        <Route path="/valuation" element={<ValuationSnapshot />} />
        <Route path="/dcf" element={<DCFCalculator />} />
        <Route path="/dividends" element={<DividendSafety />} />
        <Route path="/news-sentiment" element={<NewsSentiment />} />
        <Route path="/zero-cost-collar" element={<ZeroCostCollar />} />
        <Route path="/stocks-glossary" element={<StocksGlossary />} />
        <Route path="/research-framework" element={<ResearchFramework />} />
        <Route path="/bond-basics" element={<BondBasics />} />
        <Route path="/bond-pricing" element={<BondPricing />} />
        <Route path="/yield-curve" element={<YieldCurve />} />
        <Route path="/credit-analysis" element={<CreditAnalysis />} />
        <Route path="/bond-strategies" element={<BondStrategies />} />
        <Route path="/bond-relative-value" element={<RelativeValue />} />
        <Route path="/bond-macro" element={<BondMacro />} />
        <Route path="/bond-glossary" element={<BondGlossary />} />
        <Route path="/tradr" element={<TradrSignals />} />
        <Route path="/arbitrage-atlas" element={<ArbitrageAtlas />} />
        <Route path="/meic" element={<MEICPage />} />
        <Route path="/calendar-spreads" element={<CalendarSpreads />} />
        <Route path="/strategy-builder" element={<StrategyBuilder />} />
        <Route path="/strategy-intents" element={<StrategyIntents />} />
        <Route path="/spx-income-engine" element={<SPXIncomeEngine />} />
        <Route path="/ratio-spreads" element={<RatioSpreads />} />
      </Routes>
    </HashRouter>
  );
}
