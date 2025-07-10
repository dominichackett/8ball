import 'dotenv/config';
import * as recall from './providers/recall';
import * as coingecko from './providers/coingecko';
import * as tradeManager from './intraday_trade_manager'; // Using the same manager for simplicity

// --- Bot Configuration ---
const POLLING_INTERVAL = 300000; // 5 minutes
const HISTORICAL_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const PERFORMANCE_TRACKING_INTERVAL = 60 * 60 * 1000; // 1 hour

const historicalPrices = new Map<string, { timestamp: number; price: number; high: number; low: number; }[]>();

const TRADE_EXECUTION_ENABLED = process.env.TRADING_ENABLED === 'true';

// --- Global Configuration ---
let AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.70');

// --- Token & Strategy Configuration ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string }>();
const TRADABLE_TOKEN_ADDRESSES = new Set<string>();

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

let strategyParameters = {
    trailingStopLoss: 0.015, // 1.5% trailing stop for all trades
    maxConcurrentPositions: 5,
    // Trend-Following Params
    atrPeriod: 14,
    atrVolatilityThreshold: 0.5, // ATR as a percentage of price
    // Mean Reversion Params
    rsiPeriod: 14,
    rsiOversoldThreshold: 30,
    bollingerBandPeriod: 20,
    bollingerBandStdDev: 2,
};

// --- Main Application ---
async function main() {
  console.log('Starting Combined Strategy Trading Bot...');
  await tradeManager.loadOpenTrades();
  await initializeTradableTokens();
  await fetchAllHistoricalData();

  await runTradingCycle();
  setInterval(runTradingCycle, POLLING_INTERVAL);
  setInterval(fetchAllHistoricalData, HISTORICAL_REFRESH_INTERVAL);
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);

  console.log('Bot is running. Analyzing 15-minute charts for Trend and Mean Reversion opportunities.');
}

async function initializeTradableTokens() {
    console.log('Initializing tradable tokens...');
    TRADABLE_TOKENS.set('wrapped-bitcoin', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chain: 'evm', specificChain: 'eth', symbol: 'WBTC' });
    TRADABLE_TOKEN_ADDRESSES.add('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
    TRADABLE_TOKENS.set('weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'evm', specificChain: 'eth', symbol: 'WETH' });
    TRADABLE_TOKEN_ADDRESSES.add('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    TRADABLE_TOKENS.set('solana', { address: 'So11111111111111111111111111111111111111112', chain: 'svm', specificChain: 'svm', symbol: 'SOL' });
    TRADABLE_TOKEN_ADDRESSES.add('So11111111111111111111111111111111111111112');
    console.log(`Initialization complete. ${TRADABLE_TOKENS.size} tokens are tradable.`);
}

async function fetchAllHistoricalData() {
    console.log('\n--- Fetching 2-Day Historical Data (15-min intervals) ---');
    for (const coinId of TRADABLE_TOKENS.keys()) {
      try {
        const chartData = await coingecko.getMarketChart(coinId, { vs_currency: 'usd', days: 2 });
        if (chartData && chartData.prices) {
          const ohlc = chartData.prices.map(([timestamp, price], i, prices) => {
            const nextPrice = prices[i + 1] ? prices[i + 1][1] : price;
            const high = Math.max(price, nextPrice);
            const low = Math.min(price, nextPrice);
            return { timestamp, price, high, low };
          });
          historicalPrices.set(coinId, ohlc);
        }
      } catch (error) {
        console.error(`Error fetching historical data for ${coinId}:`, error);
      }
    }
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Combined Strategy Trading Cycle ---');
  try {
    const [portfolio, marketData] = await Promise.all([
      recall.getPortfolio(),
      coingecko.getMarketData({ vs_currency: 'usd', ids: Array.from(TRADABLE_TOKENS.keys()).join(',') }),
    ]);

    if (!portfolio || !marketData || marketData.length === 0) {
      console.error("Could not fetch portfolio or market data. Skipping cycle.");
      return;
    }

    await monitorOpenPositions();

    if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) {
      console.log('Max concurrent positions reached.');
      return;
    }

    const analyzedTokens = await analyzeCombinedOpportunities(marketData);
    const opportunities = analyzedTokens.filter(token =>
        token.isOpportunity &&
        token.aiConfidence !== undefined &&
        token.aiConfidence >= AI_CONFIDENCE_THRESHOLD
    );

    console.log(`Found ${opportunities.length} valid opportunities.`);
    await executeTrades(opportunities, portfolio);

  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

// --- Technical Indicator Calculations ---
function calculateSMA(data: number[], period: number): number[] {
    if (data.length < period) return [];
    const smaValues: number[] = [];
    for (let i = period - 1; i < data.length; i++) {
        const slice = data.slice(i - (period - 1), i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        smaValues.push(sum / period);
    }
    return smaValues;
}

function calculateEMA(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const k = 2 / (period + 1);
    const emaArray = [prices[0]];
    for (let i = 1; i < prices.length; i++) {
        emaArray.push(prices[i] * k + emaArray[i - 1] * (1 - k));
    }
    return emaArray;
}

function calculateMACD(prices: number[], shortPeriod: number = 12, longPeriod: number = 26, signalPeriod: number = 9) {
    if (prices.length < longPeriod) return null;
    const emaShort = calculateEMA(prices, shortPeriod);
    const emaLong = calculateEMA(prices, longPeriod);
    const alignedEmaShort = emaShort.slice(emaShort.length - emaLong.length);
    const macdLine = alignedEmaShort.map((short, i) => short - emaLong[i]);
    if (macdLine.length < signalPeriod) return null;
    const signalLine = calculateEMA(macdLine, signalPeriod);
    const alignedMacdLine = macdLine.slice(macdLine.length - signalLine.length);
    return { macdLine: alignedMacdLine, signalLine };
}

function calculateATR(data: { high: number; low: number; price: number }[], period: number): number[] {
    if (data.length <= period) return [];
    const trValues = [];
    for (let i = 1; i < data.length; i++) {
        const high = data[i].high;
        const low = data[i].low;
        const prevClose = data[i - 1].price;
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trValues.push(tr);
    }
    const atrValues = [];
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += trValues[i];
    }
    atrValues.push(sum / period);
    for (let i = period; i < trValues.length; i++) {
        const newAtr = (atrValues[atrValues.length - 1] * (period - 1) + trValues[i]) / period;
        atrValues.push(newAtr);
    }
    return atrValues;
}

function calculateRSI(prices: number[], period: number): number[] {
    if (prices.length <= period) return [];
    const rsiValues: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) { avgGain += change; } else { avgLoss -= change; }
    }
    avgGain /= period;
    avgLoss /= period;
    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiValues.push(100 - (100 / (1 + rs)));
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        let gain = change > 0 ? change : 0;
        let loss = change < 0 ? -change : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsiValues.push(100 - (100 / (1 + rs)));
    }
    return rsiValues;
}

function calculateBollingerBands(prices: number[], period: number, stdDev: number) {
    if (prices.length < period) return null;
    const sma = calculateSMA(prices, period);
    const middleBand = sma[sma.length - 1];
    if (middleBand === undefined) return null;
    const slice = prices.slice(-period);
    const standardDeviation = Math.sqrt(slice.map(p => Math.pow(p - middleBand, 2)).reduce((a, b) => a + b, 0) / period);
    return {
        upper: middleBand + (standardDeviation * stdDev),
        middle: middleBand,
        lower: middleBand - (standardDeviation * stdDev),
    };
}

// --- Data Analysis ---
interface AnalyzedToken {
    id: string;
    symbol: string;
    address: string;
    chain: 'evm' | 'svm';
    specificChain: string;
    current_price: number;
    isOpportunity: boolean;
    strategy: 'Trend' | 'MeanReversion' | 'None';
    aiConfidence?: number;
    // Add all possible indicators
    indicators: any;
}

async function analyzeCombinedOpportunities(marketData: any[]): Promise<AnalyzedToken[]> {
    let analyzedTokens: AnalyzedToken[] = [];

    for (const coin of marketData) {
        if (!TRADABLE_TOKENS.has(coin.id)) continue;

        const historical = historicalPrices.get(coin.id);
        if (!historical || historical.length < 26) continue;

        const prices = historical.map(data => data.price);
        
        // Calculate all indicators
        const macd = calculateMACD(prices);
        const atrValues = calculateATR(historical, strategyParameters.atrPeriod);
        const rsiValues = calculateRSI(prices, strategyParameters.rsiPeriod);
        const bollingerBands = calculateBollingerBands(prices, strategyParameters.bollingerBandPeriod, strategyParameters.bollingerBandStdDev);

        if (!macd || atrValues.length === 0 || rsiValues.length === 0 || !bollingerBands) {
            console.log(`Could not calculate all indicators for ${coin.id}.`);
            continue;
        }

        let isOpportunity = false;
        let strategy: 'Trend' | 'MeanReversion' | 'None' = 'None';

        // Trend-Following Logic
        const macdCrossedUp = macd.macdLine[macd.macdLine.length - 2] <= macd.signalLine[macd.signalLine.length - 2] && macd.macdLine[macd.macdLine.length - 1] > macd.signalLine[macd.signalLine.length - 1];
        const isVolatile = (atrValues[atrValues.length - 1] / coin.current_price) * 100 > strategyParameters.atrVolatilityThreshold;
        if (macdCrossedUp && isVolatile) {
            isOpportunity = true;
            strategy = 'Trend';
        }

        // Mean Reversion Logic (only if trend opportunity not found)
        const rsi = rsiValues[rsiValues.length - 1];
        const isOversold = rsi <= strategyParameters.rsiOversoldThreshold;
        const priceAtLowerBand = coin.current_price <= bollingerBands.lower;
        if (!isOpportunity && isOversold && priceAtLowerBand) {
            isOpportunity = true;
            strategy = 'MeanReversion';
        }

        const analyzedToken: AnalyzedToken = {
            ...coin,
            ...TRADABLE_TOKENS.get(coin.id),
            current_price: coin.current_price,
            isOpportunity,
            strategy,
            indicators: { macd, atr: atrValues[atrValues.length - 1], rsi, bollingerBands }
        };

        if (isOpportunity) {
            analyzedToken.aiConfidence = await getTradeConfidence(analyzedToken);
        }

        console.log(
            `Analyzed ${coin.symbol.toUpperCase()}: ` +
            `Price: ${coin.current_price.toFixed(2)}, ` +
            `Strategy: ${strategy}, ` +
            `Trend Opp: ${macdCrossedUp && isVolatile}, ` +
            `Mean Rev Opp: ${isOversold && priceAtLowerBand}, ` +
            `AI Conf: ${analyzedToken.aiConfidence ? analyzedToken.aiConfidence.toFixed(2) : 'N/A'}`
        );

        analyzedTokens.push(analyzedToken);
    }
    return analyzedTokens;
}

// --- Trade Execution & Management ---
async function monitorOpenPositions() { /* ... same as intraday_bot.ts ... */ }

async function executeTrades(opportunities: AnalyzedToken[], portfolio: any) {
    console.log(`Executing trades for ${opportunities.length} opportunities...`);
    const usdcTokens = portfolio.tokens.filter((t: any) => t.token === USDC_ADDRESS || t.token === USDC_SVM_ADDRESS);
    let availableCapital = usdcTokens.reduce((sum: number, t: any) => sum + t.amount, 0);
    const FIXED_POSITION_SIZE = 1000;

    for (const opportunity of opportunities) {
        if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) break;
        if (tradeManager.getOpenTrades().some(trade => trade.toTokenSymbol === opportunity.symbol)) continue;
        if (availableCapital < FIXED_POSITION_SIZE) continue;

        const fromTokenAddress = opportunity.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS;
        const reason = `${opportunity.strategy} Strategy. AI Conf: ${(opportunity.aiConfidence! * 100).toFixed(0)}%`;

        console.log(`Executing ${opportunity.strategy} trade for ${opportunity.symbol.toUpperCase()}...`);

        if (TRADE_EXECUTION_ENABLED) {
            try {
                await recall.executeTrade({
                    fromToken: fromTokenAddress,
                    toToken: opportunity.address,
                    amount: FIXED_POSITION_SIZE.toString(),
                    reason: reason,
                    chain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'evm',
                    specificChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : opportunity.specificChain, // Use opportunity's specificChain for EVM
                });
                availableCapital -= FIXED_POSITION_SIZE;
                await tradeManager.addOpenTrade({
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 15),
                    fromToken: fromTokenAddress,
                    fromTokenSymbol: "USDC",
                    fromChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'evm',
                    fromSpecificChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : opportunity.specificChain,
                    fromAmount: FIXED_POSITION_SIZE,
                    toToken: opportunity.address,
                    toTokenSymbol: opportunity.symbol,
                    toChain: opportunity.chain,
                    toSpecificChain: opportunity.specificChain,
                    toAmount: (FIXED_POSITION_SIZE / opportunity.current_price).toString(),
                    price: opportunity.current_price,
                    tradeAmountUsd: FIXED_POSITION_SIZE,
                    timestamp: new Date().toISOString(),
                    competitionId: "N/A",
                    agentId: "N/A",
                    reason: reason,
                    highWaterMark: opportunity.current_price, // Initialize highWaterMark
                });
                console.log(`SUCCESS: Trade executed for ${opportunity.symbol.toUpperCase()}.`);
            } catch (error) {
                console.error(`Error executing trade for ${opportunity.symbol.toUpperCase()}:`, error);
            }
        } else {
            console.log(`DRY RUN: Trade for ${opportunity.symbol.toUpperCase()} was identified but not executed.`);
        }
    }
}

// --- AI and Performance ---
async function getTradeConfidence(analyzedToken: AnalyzedToken): Promise<number> {
    const { symbol, indicators, current_price, strategy } = analyzedToken;
    let prompt = `Analyze ${symbol.toUpperCase()} for a BUY trade on a 15-min chart based on a ${strategy} strategy.\n`;
    prompt += `Provide a confidence score from 0.0 to 1.0. Return ONLY the numeric score in <score> tags.\n\n`;

    if (strategy === 'Trend') {
        prompt += `Strategy: Trend-Following (MACD Crossover + Volatility)\n`;
        prompt += `Indicators:\n- Price: ${current_price.toFixed(4)}\n`;
        prompt += `- MACD: Line (${indicators.macd.macdLine[indicators.macd.macdLine.length - 1].toFixed(4)}) has crossed ABOVE Signal (${indicators.macd.signalLine[indicators.macd.signalLine.length - 1].toFixed(4)}).\n`;
        prompt += `- Volatility (ATR): Market is ACTIVE (ATR: ${indicators.atr.toFixed(4)}).\n`;
    } else if (strategy === 'MeanReversion') {
        prompt += `Strategy: Mean Reversion (Oversold RSI + Lower Bollinger Band)\n`;
        prompt += `Indicators:\n- Price: ${current_price.toFixed(4)}\n`;
        prompt += `- RSI: ${indicators.rsi.toFixed(2)} (Oversold threshold: ${strategyParameters.rsiOversoldThreshold}).\n`;
        prompt += `- Bollinger Bands: Price is AT OR BELOW the lower band (${indicators.bollingerBands.lower.toFixed(4)}).\n`;
    }

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) return 0;
        const result = await response.json();
        const scoreMatch = result.response.match(/<score>([0-9.]+)<!--\/score-->/);
        if (scoreMatch && scoreMatch[1]) {
            const confidence = parseFloat(scoreMatch[1]);
            console.log(`AI confidence for ${symbol.toUpperCase()} (${strategy}): ${confidence.toFixed(2)}`);
            return confidence;
        }
        return 0;
    } catch (error) {
        console.error(`Error in getTradeConfidence for ${symbol}:`, error);
        return 0;
    }
}

async function trackPerformance() {
    console.log("
--- Generating Performance Report ---");
    const [portfolio, trades] = await Promise.all([
        recall.getPortfolio(),
        recall.getAgentTrades()
    ]);

    if (portfolio && trades) {
        // Assuming initial portfolio value is 10000 for PnL calculation, adjust as needed
        const pnl = (portfolio.totalValue / 10000) - 1; 
        const winRate = calculateWinRate(trades.trades);
        console.log(`  Portfolio Value: ${portfolio.totalValue.toFixed(2)}`);
        console.log(`  Total PnL: ${(pnl * 100).toFixed(2)}%`);
        console.log(`  Win Rate: ${winRate.toFixed(2)}%`);
        adaptStrategy(pnl, winRate);
    }
}

function adaptStrategy(pnl: number, winRate: number) {
  console.log("Adapting strategy based on performance...");
  // Example adaptation logic - can be customized
  if (pnl < -0.05 && winRate < 0.4) { // If losing money and low win rate
    console.log("Performance is poor. Tightening risk parameters.");
    strategyParameters.trailingStopLoss = Math.min(strategyParameters.trailingStopLoss + 0.005, 0.03); // Increase stop loss
    strategyParameters.maxConcurrentPositions = Math.max(strategyParameters.maxConcurrentPositions - 1, 1); // Reduce concurrent positions
  } else if (pnl > 0.05 && winRate > 0.6) { // If performing well
    console.log("Performance is strong. Slightly increasing risk appetite.");
    strategyParameters.trailingStopLoss = Math.max(strategyParameters.trailingStopLoss - 0.005, 0.01); // Decrease stop loss
    strategyParameters.maxConcurrentPositions = Math.min(strategyParameters.maxConcurrentPositions + 1, 10); // Increase concurrent positions
  }
}

function calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const profitableTrades = trades.filter(t => parseFloat(t.pnl) > 0).length;
    return (profitableTrades / trades.length) * 100;
}
    console.log("\n--- Generating Performance Report ---");
    const [portfolio, trades] = await Promise.all([
        recall.getPortfolio(),
        recall.getAgentTrades()
    ]);

    if (portfolio && trades) {
        // Assuming initial portfolio value is 10000 for PnL calculation, adjust as needed
        const pnl = (portfolio.totalValue / 10000) - 1; 
        const winRate = calculateWinRate(trades.trades);
        console.log(`  Portfolio Value: ${portfolio.totalValue.toFixed(2)}`);
        console.log(`  Total PnL: ${(pnl * 100).toFixed(2)}%`);
        console.log(`  Win Rate: ${winRate.toFixed(2)}%`);
        adaptStrategy(pnl, winRate);
    }
}

function adaptStrategy(pnl: number, winRate: number) {
  console.log("Adapting strategy based on performance...");
  // Example adaptation logic - can be customized
  if (pnl < -0.05 && winRate < 0.4) { // If losing money and low win rate
    console.log("Performance is poor. Tightening risk parameters.");
    strategyParameters.trailingStopLoss = Math.min(strategyParameters.trailingStopLoss + 0.005, 0.03); // Increase stop loss
    strategyParameters.maxConcurrentPositions = Math.max(strategyParameters.maxConcurrentPositions - 1, 1); // Reduce concurrent positions
  } else if (pnl > 0.05 && winRate > 0.6) { // If performing well
    console.log("Performance is strong. Slightly increasing risk appetite.");
    strategyParameters.trailingStopLoss = Math.max(strategyParameters.trailingStopLoss - 0.005, 0.01); // Decrease stop loss
    strategyParameters.maxConcurrentPositions = Math.min(strategyParameters.maxConcurrentPositions + 1, 10); // Increase concurrent positions
  }
}

function calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const profitableTrades = trades.filter(t => parseFloat(t.pnl) > 0).length;
    return (profitableTrades / trades.length) * 100;
}

// --- Start Bot ---
main();
