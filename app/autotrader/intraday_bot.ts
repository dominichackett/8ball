import 'dotenv/config';
import * as recall from './providers/recall';
import * as coingecko from './providers/coingecko';
import * as tradeManager from './intraday_trade_manager';

// --- Bot Configuration ---
const POLLING_INTERVAL = 300000; // 5 minutes, aligned with 15-min chart analysis
const HISTORICAL_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
const PERFORMANCE_TRACKING_INTERVAL = 60 * 60 * 1000; // 1 hour

// Store OHLC data for ATR calculation
const historicalPrices = new Map<string, { timestamp: number; price: number; high: number; low: number; }[]>();

// --- Global Configuration ---
let AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.70');

// --- Token & Strategy Configuration ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string }>();
const TRADABLE_TOKEN_ADDRESSES = new Set<string>();

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

let strategyParameters = {
    maxPositionSize: 0.05, // 5% of portfolio
    trailingStopLoss: 0.015, // 1.5% trailing stop
    maxConcurrentPositions: 5,
    atrPeriod: 14,
    atrVolatilityThreshold: 0.5, // ATR as a percentage of price
};

// --- Main Application ---
async function main() {
  console.log('Starting Intraday Trend & Volatility Trading Bot...');
  await tradeManager.loadOpenTrades();
  await initializeTradableTokens();
  await fetchAllHistoricalData();

  await runTradingCycle();
  setInterval(runTradingCycle, POLLING_INTERVAL);
  setInterval(fetchAllHistoricalData, HISTORICAL_REFRESH_INTERVAL);
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);

  console.log('Bot is running. Analyzing 15-minute charts with 5-minute live price updates.');
}

async function initializeTradableTokens() {
    console.log('Initializing tradable tokens for intraday strategy...');
    // Focusing on high-volume tokens suitable for intraday trading
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
          console.log(`Fetched ${chartData.prices.length} historical data points for ${coinId}`);
          // Simulate OHLC data from price data for ATR calculation
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
    console.log('--- Historical Data Fetch Complete ---');
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Intraday Trading Cycle ---');
  try {
    const [portfolio, marketData, agentBalances] = await Promise.all([
      recall.getPortfolio(),
      coingecko.getMarketData({ vs_currency: 'usd', ids: Array.from(TRADABLE_TOKENS.keys()).join(',') }),
      recall.getAgentBalances()
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

    const analyzedTokens = await analyzeIntradayOpportunities(marketData);
    const opportunities = analyzedTokens.filter(token =>
        token.isOpportunity &&
        token.aiConfidence !== undefined &&
        token.aiConfidence >= AI_CONFIDENCE_THRESHOLD
    );

    console.log(`Found ${opportunities.length} valid opportunities.`);
    await executeTrades(opportunities, portfolio, new Map()); // Simplified balances for now

  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

// --- Technical Indicator Calculations ---
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

function calculateATR(data: { high: number; low: number; price: number }[], period: number = 14): number[] {
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

// --- Data Analysis ---
interface AnalyzedToken {
    id: string;
    symbol: string;
    address: string;
    chain: 'evm' | 'svm';
    specificChain: string;
    current_price: number;
    indicators: {
        macdLine: number;
        signalLine: number;
        macdCrossedUp: boolean;
        atr: number;
        isVolatile: boolean;
    };
    isOpportunity: boolean;
    aiConfidence?: number;
}

async function analyzeIntradayOpportunities(marketData: any[]): Promise<AnalyzedToken[]> {
    if (!marketData) return [];
    let analyzedTokens: AnalyzedToken[] = [];

    for (const coin of marketData) {
        if (!TRADABLE_TOKENS.has(coin.id)) continue;

        const historical = historicalPrices.get(coin.id);
        if (!historical || historical.length < 26) {
            console.log(`Not enough historical data for ${coin.id} to analyze.`);
            continue;
        }

        const prices = historical.map(data => data.price);
        const macd = calculateMACD(prices);
        const atrValues = calculateATR(historical, strategyParameters.atrPeriod);

        if (!macd || atrValues.length === 0) {
            console.log(`Could not calculate indicators for ${coin.id}.`);
            continue;
        }

        const macdLine = macd.macdLine;
        const signalLine = macd.signalLine;
        const macdCrossedUp = macdLine[macdLine.length - 2] <= signalLine[signalLine.length - 2] &&
                              macdLine[macdLine.length - 1] > signalLine[signalLine.length - 1];

        const currentAtr = atrValues[atrValues.length - 1];
        const isVolatile = (currentAtr / coin.current_price) * 100 > strategyParameters.atrVolatilityThreshold;

        const tokenInfo = TRADABLE_TOKENS.get(coin.id);
        const isOpportunity = macdCrossedUp && isVolatile;

        const analyzedToken: AnalyzedToken = {
            ...coin,
            ...tokenInfo,
            current_price: coin.current_price,
            indicators: {
                macdLine: macdLine[macdLine.length - 1],
                signalLine: signalLine[signalLine.length - 1],
                macdCrossedUp,
                atr: currentAtr,
                isVolatile,
            },
            isOpportunity,
        };

        if (isOpportunity) {
            analyzedToken.aiConfidence = await getTradeConfidence(analyzedToken);
        }

        console.log(
            `Analyzed ${coin.symbol.toUpperCase()}: ` +
            `Price: ${coin.current_price.toFixed(4)}, ` +
            `MACD: ${macdLine[macdLine.length - 1].toFixed(4)}, ` +
            `Signal: ${signalLine[signalLine.length - 1].toFixed(4)}, ` +
            `ATR: ${currentAtr.toFixed(4)}, ` +
            `Is Volatile: ${isVolatile}, ` +
            `MACD Crossed Up: ${macdCrossedUp}, ` +
            `Is Opportunity: ${isOpportunity}, ` +
            `AI Confidence: ${analyzedToken.aiConfidence ? analyzedToken.aiConfidence.toFixed(2) : 'N/A'}`
        );

        analyzedTokens.push(analyzedToken);
    }
    return analyzedTokens;
}

// --- Trade Execution & Management ---
async function monitorOpenPositions() {
    console.log("Monitoring open positions with trailing stop-loss...");
    for (const trade of tradeManager.getOpenTrades()) {
        // Assumes trade object has highWaterMark, which needs to be added to trade_manager.ts
        if (!trade.highWaterMark) trade.highWaterMark = trade.price;

        const currentPriceResult = await recall.getPrice({ token: trade.toToken, chain: trade.toChain, specificChain: trade.toSpecificChain });
        if (currentPriceResult) {
            const currentPrice = currentPriceResult.price;
            if (currentPrice > trade.highWaterMark) {
                trade.highWaterMark = currentPrice;
                await tradeManager.updateOpenTrade(trade.id, { highWaterMark: currentPrice });
            }

            const stopPrice = trade.highWaterMark * (1 - strategyParameters.trailingStopLoss);
            if (currentPrice <= stopPrice) {
                console.log(`Trailing stop-loss triggered for ${trade.toTokenSymbol} at ${currentPrice.toFixed(4)}. Stop price was ${stopPrice.toFixed(4)}.`);
                await recall.executeTrade({
                    fromToken: trade.toToken,
                    toToken: trade.fromToken,
                    amount: trade.toAmount,
                    reason: 'Trailing stop-loss triggered',
                    chain: trade.toChain,
                    specificChain: trade.toSpecificChain,
                });
                await tradeManager.removeOpenTrade(trade.id);
            }
        }
    }
}

async function executeTrades(opportunities: AnalyzedToken[], portfolio: any, tradeableEvmUsdcBalances: Map<string, { amount: number, address: string }>) {
  console.log(`Executing trades for ${opportunities.length} opportunities...`);

  const usdcTokens = portfolio.tokens.filter((t: any) => t.token === USDC_ADDRESS || t.token === USDC_SVM_ADDRESS);
  let availableCapital = usdcTokens.reduce((sum: number, t: any) => sum + t.amount, 0);
  if (availableCapital < 1000) {
    console.log(`Insufficient USDC balance (${availableCapital.toFixed(2)}). Need at least 1000 USDC to trade.`);
    return;
  }

  const FIXED_POSITION_SIZE = 1000;

  for (const opportunity of opportunities) {
    if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) {
      console.log("Max concurrent positions reached. Cannot open new trades.");
      break;
    }

    if (tradeManager.getOpenTrades().some(trade => trade.toTokenSymbol === opportunity.symbol)) {
      console.log(`Skipping trade for ${opportunity.symbol.toUpperCase()}: Position already open.`);
      continue;
    }

    if (availableCapital < FIXED_POSITION_SIZE) {
        console.log(`Skipping trade for ${opportunity.symbol.toUpperCase()}: Insufficient capital for this trade. Have ${availableCapital.toFixed(2)}, need ${FIXED_POSITION_SIZE}.`);
        continue;
    }

    const fromTokenAddress = opportunity.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS;
    const reason = `Intraday Trend/Volatility. AI Confidence: ${(opportunity.aiConfidence! * 100).toFixed(0)}%`;

    console.log(`Executing entry for ${opportunity.symbol.toUpperCase()} with fixed size of ${FIXED_POSITION_SIZE} USDC.`);
    try {
      await recall.executeTrade({
        fromToken: fromTokenAddress,
        toToken: opportunity.address,
        amount: FIXED_POSITION_SIZE.toString(),
        reason: reason,
        chain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'evm',
        specificChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'base', // Default to base for EVM
      });

      availableCapital -= FIXED_POSITION_SIZE; // Decrement capital for this cycle

      await tradeManager.addOpenTrade({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 15),
        fromToken: fromTokenAddress,
        fromTokenSymbol: "USDC",
        fromChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'evm',
        fromSpecificChain: fromTokenAddress === USDC_SVM_ADDRESS ? 'svm' : 'base',
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
    } catch (error) {
      console.error(`Error executing trade for ${opportunity.symbol.toUpperCase()}:`, error);
    }
  }
}

// --- AI and Performance ---
async function getTradeConfidence(analyzedToken: AnalyzedToken): Promise<number> {
    const { symbol, indicators, current_price } = analyzedToken;
    const prompt = `
Analyze ${symbol.toUpperCase()} for an intraday BUY trade on a 15-min chart.
Provide a confidence score from 0.0 to 1.0. Return ONLY the numeric score in <score> tags.

Indicators:
- Price: ${current_price.toFixed(4)}
- MACD: Line (${indicators.macdLine.toFixed(4)}) has crossed ABOVE Signal (${indicators.signalLine.toFixed(4)}).
- Volatility (ATR): Market is ACTIVE (ATR: ${indicators.atr.toFixed(4)}).

This is a valid opportunity based on the bot's strategy (MACD Crossover + Volatility).
Provide your independent confidence score.`;

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) {
            console.error(`AI API Error for ${symbol}: ${response.statusText}`);
            return 0;
        }
        const result = await response.json();
        const scoreMatch = result.response.match(/<score>([0-9.]+)<!--\/score-->/);
        if (scoreMatch && scoreMatch[1]) {
            const confidence = parseFloat(scoreMatch[1]);
            console.log(`AI confidence for ${symbol.toUpperCase()}: ${confidence.toFixed(2)}`);
            return confidence;
        }
        console.error(`Failed to parse AI score for ${symbol}.`);
        return 0;
    } catch (error) {
        console.error(`Error in getTradeConfidence for ${symbol}:`, error);
        return 0;
    }
}

async function trackPerformance() {
    // Performance tracking logic can be reused from 8ball.ts
}

// --- Start Bot ---
main();
