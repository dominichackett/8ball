import 'dotenv/config';
import * as recall from './providers/recall';

import * as coingecko from './providers/coingecko';
import * as tradeManager from './trade_manager';

// --- Bot Configuration ---
const POLLING_INTERVAL = 300000; // 5 minutes for live price checks
const HISTORICAL_REFRESH_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
const PERFORMANCE_TRACKING_INTERVAL = 60 * 60 * 1000; // 1 hour

const historicalPortfolioValues = new Map<number, number>(); // timestamp -> totalValue
const historicalPrices = new Map<string, { timestamp: number; price: number; }[]>(); // coinId -> [{timestamp, price}]

// --- Global Configuration (Modifiable via CLI) ---
let OVERRIDE_ENABLED = process.env.BOT_OVERRIDE_ENABLED === 'true';
let DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.75; // Used when override is OFF
let OVERRIDE_AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.75'); // Used when override is ON
let CLOSE_ALL_POSITIONS = process.env.BOT_CLOSE_ALL_POSITIONS === 'true';

// --- Token & Strategy Configuration ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string }>();
const TRADABLE_TOKEN_ADDRESSES = new Set<string>();

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Assuming USDC on Ethereum
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on SVM

let strategyParameters = {
    maxPositionSize: 0.03, // 3% of portfolio
    stopLoss: 0.005, // 0.5%
    takeProfit: 0.01, // 1%
    maxConcurrentPositions: 10,
    dailyLossLimit: -0.05, // -5%
};

// --- Main Application ---
async function main() {
  console.log('Starting Autonomous Trading Bot...');
  await tradeManager.loadOpenTrades();

  if (CLOSE_ALL_POSITIONS) {
    console.log('BOT_CLOSE_ALL_POSITIONS is true. Closing all open positions...');
    const openTrades = tradeManager.getOpenTrades();
    if (openTrades.length === 0) {
      console.log('No open positions to close.');
    } else {
      for (const trade of openTrades) {
        try {
          console.log(`Attempting to close position for ${trade.toTokenSymbol}...`);
          await recall.executeTrade({
            fromToken: trade.toToken,
            toToken: trade.fromToken, // Sell back to the original currency (USDC)
            amount: trade.toAmount, // Amount of the token to sell
            reason: 'Manual close all positions',
            chain: trade.toChain,
            specificChain: trade.toSpecificChain,
          });
          await tradeManager.removeOpenTrade(trade.id);
          console.log(`Successfully closed position for ${trade.toTokenSymbol}.`);
        } catch (error) {
          console.error(`Error closing position for ${trade.toTokenSymbol}:`, error);
        }
      }
      console.log('All open positions processed.');
    }
    // Exit after closing positions if this is a one-off command
    // process.exit(0); // Uncomment if you want the bot to exit after closing all positions
  }

  await initializeTradableTokens();
  await fetchAllHistoricalData(); // Initial data fetch for immediate trading
  
  // Set up periodic tasks
  await runTradingCycle(); // Run immediately on startup
  setInterval(runTradingCycle, POLLING_INTERVAL); // Frequent live price checks
  setInterval(fetchAllHistoricalData, HISTORICAL_REFRESH_INTERVAL); // Infrequent full history refresh
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);
  
  console.log('Bot is running. Analyzing hourly charts with 5-minute live price updates.');
}

async function initializeTradableTokens() {
    console.log('Initializing tradable tokens...');
    TRADABLE_TOKENS.set('aave', { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', chain: 'evm', specificChain: 'eth', symbol: 'AAVE' });
    TRADABLE_TOKEN_ADDRESSES.add('0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9');
    TRADABLE_TOKENS.set('dogecoin', { address: '0x1121AcC14c63f3C872BFcA497d10926A6098AAc5', chain: 'evm', specificChain: 'eth', symbol: 'DOGE' });
    TRADABLE_TOKEN_ADDRESSES.add('0x1121AcC14c63f3C872BFcA497d10926A6098AAc5');
    TRADABLE_TOKENS.set('wrapped-bitcoin', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chain: 'evm', specificChain: 'eth', symbol: 'WBTC' });
    TRADABLE_TOKEN_ADDRESSES.add('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
    TRADABLE_TOKENS.set('weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'evm', specificChain: 'eth', symbol: 'WETH' });
    TRADABLE_TOKEN_ADDRESSES.add('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    TRADABLE_TOKENS.set('chainlink', { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'evm', specificChain: 'eth', symbol: 'LINK' });
    TRADABLE_TOKEN_ADDRESSES.add('0x514910771af9ca656af840dff83e8264ecf986ca');
    TRADABLE_TOKENS.set('ripple', { address: '0x07E0EDf8ce600FB51d44F51E3348D77D67F298ae', chain: 'evm', specificChain: 'eth', symbol: 'XRP' });
    TRADABLE_TOKEN_ADDRESSES.add('0x07E0EDf8ce600FB51d44F51E3348D77D67F298ae');
    TRADABLE_TOKENS.set('bonk', { address: '0x1151CB3d861920e07a38e03eEAd12C32178567F6', chain: 'evm', specificChain: 'eth', symbol: 'BONK' });
    TRADABLE_TOKEN_ADDRESSES.add('0x1151CB3d861920e07a38e03eEAd12C32178567F6');
    TRADABLE_TOKENS.set('pepe', { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'evm', specificChain: 'eth', symbol: 'PEPE' });
    TRADABLE_TOKEN_ADDRESSES.add('0x6982508145454ce325ddbe47a25d4ec3d2311933');
    TRADABLE_TOKENS.set('solana', { address: 'So11111111111111111111111111111111111111112', chain: 'svm', specificChain: 'svm', symbol: 'SOL' });
    TRADABLE_TOKEN_ADDRESSES.add('So11111111111111111111111111111111111111112');
   
    
    console.log(`Initialization complete. ${TRADABLE_TOKENS.size} tokens are tradable.`);
}

async function fetchAllHistoricalData() {
    console.log('\n--- Fetching Full 7-Day Historical Data (Hourly) ---');
    for (const coinId of TRADABLE_TOKENS.keys()) {
      try {
        const chartData = await coingecko.getMarketChart(coinId, { vs_currency: 'usd', days: 7 });
        if (chartData && chartData.prices) {
          console.log(`Fetched ${chartData.prices.length} historical data points for ${coinId}`);
          historicalPrices.set(coinId, chartData.prices.map(([timestamp, price]: [number, number]) => ({ timestamp, price })));
        }
      } catch (error) {
        console.error(`Error fetching historical data for ${coinId}:`, error);
      }
    }
    console.log('--- Historical Data Fetch Complete ---');
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Trading Cycle (Live Prices) ---');
  try {
    const [portfolio, marketData, agentBalances] = await Promise.all([
      recall.getPortfolio(),
      coingecko.getMarketData({ vs_currency: 'usd', ids: Array.from(TRADABLE_TOKENS.keys()).join(',') }),
      recall.getAgentBalances()
    ]);

    let tradeableEvmUsdcBalances = new Map<string, { amount: number, address: string }>(); // Initialize here

    if (agentBalances) {
        console.log('Agent Balances:', agentBalances);
        agentBalances.balances.forEach((balance: any) => {
            if (balance.symbol === 'USDC' && balance.chain === 'evm') {
                tradeableEvmUsdcBalances.set(balance.specificChain, {
                    amount: (tradeableEvmUsdcBalances.get(balance.specificChain)?.amount || 0) + balance.amount,
                    address: balance.tokenAddress
                });
            }
        });

        tradeableEvmUsdcBalances.forEach((data, chain) => {
            console.log(`Tradeable USDC Balance on ${chain.toUpperCase()}: ${data.amount}`);
        });

        const svmUsdcBalance = agentBalances.balances
            .filter((balance: any) => balance.symbol === 'USDC' && balance.chain === 'svm')
            .reduce((sum: number, balance: any) => sum + balance.amount, 0);
        if (svmUsdcBalance) {
            console.log(`Tradeable SVM USDC Balance: ${svmUsdcBalance}`);
        }
    }

    if (!portfolio) {
        console.error("Could not fetch portfolio. Skipping cycle.");
        return;
    }
     if (!marketData || marketData.length === 0) {
        console.error("Could not fetch market data. Skipping cycle.");
        return;
    }
    
    await monitorOpenPositions(portfolio);

    if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) {
      console.log('Max concurrent positions reached.');
      return;
    }

    const analyzedTokens = await analyzeMomentumOpportunities(marketData); // Now async
    
    let opportunities: AnalyzedToken[];
    if (OVERRIDE_ENABLED) {
        opportunities = analyzedTokens.filter(token => token.aiConfidence !== undefined && token.aiConfidence >= OVERRIDE_AI_CONFIDENCE_THRESHOLD);
        console.log(`Override enabled. Found ${opportunities.length} opportunities based on AI confidence >= ${OVERRIDE_AI_CONFIDENCE_THRESHOLD}.`);
    } else {
        opportunities = analyzedTokens.filter(token => token.isOpportunity && token.aiConfidence !== undefined && token.aiConfidence >= DEFAULT_AI_CONFIDENCE_THRESHOLD);
        console.log(`Override disabled. Found ${opportunities.length} opportunities based on TA and AI confidence >= ${DEFAULT_AI_CONFIDENCE_THRESHOLD}.`);
    }

    await executeTrades(opportunities, portfolio, tradeableEvmUsdcBalances);

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

function calculateRSI(prices: number[], period: number = 14): number[] {
    if (prices.length <= period) return [];

    const rsiValues: number[] = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss -= change;
        }
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

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2) {
    if (prices.length < period) return null;

    const sma = calculateSMA(prices, period);
    const middleBand = sma[sma.length - 1];
    if (middleBand === 0) return null;

    const slice = prices.slice(-period);
    const standardDeviation = Math.sqrt(slice.map(p => Math.pow(p - middleBand, 2)).reduce((a, b) => a + b, 0) / period);

    return {
        upper: middleBand + (standardDeviation * stdDev),
        middle: middleBand,
        lower: middleBand - (standardDeviation * stdDev),
    };
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
    const histogram = alignedMacdLine.map((macd, i) => macd - signalLine[i]);

    return {
        macdLine: alignedMacdLine,
        signalLine,
        histogram,
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
    price_change_percentage_1h_in_currency?: number;
    total_volume: number;
    market_cap: number;
    indicators: {
        rsi: number;
        rsiMA: number;
        rsiCrossedUp: boolean;
        priceAtLowerBand: boolean;
        macdLine: number;
        signalLine: number;
        macdCrossedUp: boolean;
    };
    bollingerBands: { upper: number; middle: number; lower: number; } | null; // Now a required property
    isOpportunity: boolean;
    aiConfidence?: number; // Added AI confidence to interface
    allRsiValues: number[];
    allMacdLine: number[];
    allSignalLine: number[];
}

async function analyzeMomentumOpportunities(marketData: any[]): Promise<AnalyzedToken[]> {
    if (!marketData) return [];

    let analyzedTokens: AnalyzedToken[] = [];

    for (const coin of marketData) {
        if (!TRADABLE_TOKENS.has(coin.id)) continue;

        const historical = historicalPrices.get(coin.id);
        if (!historical || historical.length < 26) {
            console.log(`Not enough historical data for ${coin.id} to analyze. Waiting for next fetch.`);
            continue;
        }

        const prices = historical.map(data => data.price);
        const currentPrice = coin.current_price;
        if (!currentPrice) {
            console.log(`No live price for ${coin.id} in market data. Skipping.`);
            continue;
        }

        const rsiValues = calculateRSI(prices);
        const bollingerBands = calculateBollingerBands(prices);
        const macd = calculateMACD(prices);

        // Ensure all indicators are calculated before proceeding
        if (rsiValues.length === 0 || !macd || !bollingerBands) { // Added bollingerBands to check
            console.log(`Could not calculate core indicators for ${coin.id}. Skipping.`);
            continue;
        }

        const rsiMAPeriod = 9;
        const rsiMAValues = calculateSMA(rsiValues, rsiMAPeriod);
        const alignedRsiValues = rsiValues.slice(rsiValues.length - rsiMAValues.length);

        if (alignedRsiValues.length < 2) {
            console.log(`Not enough aligned RSI data for crossover check for ${coin.id}. Skipping.`);
            continue;
        }

        const macdLine = macd.macdLine;
        const signalLine = macd.signalLine;

        const macdCrossedUp = macdLine[macdLine.length - 2] <= signalLine[signalLine.length - 2] && 
                              macdLine[macdLine.length - 1] > signalLine[signalLine.length - 1];

        // priceAtLowerBand can now directly use bollingerBands as it's guaranteed not null
        const priceAtLowerBand = currentPrice <= bollingerBands.lower;

        const rsiCrossedUp = alignedRsiValues[alignedRsiValues.length - 2] <= rsiMAValues[rsiMAValues.length - 2] &&
                             alignedRsiValues[alignedRsiValues.length - 1] > rsiMAValues[rsiMAValues.length - 1];

        const tokenInfo = TRADABLE_TOKENS.get(coin.id);
        const isOpportunity = macdCrossedUp && priceAtLowerBand && rsiCrossedUp;

        const analyzedToken: AnalyzedToken = {
            ...coin,
            ...tokenInfo,
            current_price: currentPrice,
            indicators: {
                rsi: alignedRsiValues[alignedRsiValues.length - 1],
                rsiMA: rsiMAValues[rsiMAValues.length - 1],
                rsiCrossedUp,
                priceAtLowerBand,
                macdLine: macdLine[macdLine.length - 1],
                signalLine: signalLine[signalLine.length - 1],
                macdCrossedUp,
            },
            bollingerBands: bollingerBands, // Explicitly assign bollingerBands (now guaranteed not null)
            isOpportunity,
        };
        
        // Get AI confidence for this token and store it
        analyzedToken.aiConfidence = await getTradeConfidence(analyzedToken);

        analyzedTokens.push(analyzedToken);

        // Log the analyzed token to inspect its structure
        // console.log(`Analyzed Token for ${coin.id.toUpperCase()}:`, JSON.stringify(analyzedToken, null, 2));
    }
    return analyzedTokens;
}

// --- Trade Execution & Management ---
async function monitorOpenPositions(portfolio: any) {
  console.log("Monitoring open positions...");
  for (const token of tradeManager.getOpenTrades()) {
    if (!TRADABLE_TOKEN_ADDRESSES.has(token.token)) {
      continue;
    }
    const entryPrice = token.price; 
    const currentPrice = await recall.getPrice({ token: token.token, chain: token.chain, specificChain: token.specificChain });
    if (currentPrice) {
      const currentPriceValue = currentPrice.price;
      const pnl = (currentPriceValue - entryPrice) / entryPrice;

      const stopLossHit = pnl <= -strategyParameters.stopLoss;
      const takeProfitHit = pnl >= strategyParameters.takeProfit;

      if (stopLossHit || takeProfitHit) {
        const reason = stopLossHit ? 'Stop-loss triggered' : 'Take-profit triggered';
        console.log(`Executing exit for ${token.symbol}: ${reason}`);
        await recall.executeTrade({
          fromToken: token.token,
          toToken: USDC_ADDRESS,
          amount: token.amount.toString(),
          reason: reason,
        });
        await tradeManager.removeOpenTrade(token.id);
      }
    }
  }
}

async function executeTrades(opportunities: AnalyzedToken[], portfolio: any, tradeableEvmUsdcBalances: Map<string, { amount: number, address: string }>) {
  console.log("Executing new trades...");
  if (tradeableEvmUsdcBalances.size === 0 && (portfolio.tokens.find((token: any) => token.token === USDC_SVM_ADDRESS && token.chain === 'svm')?.amount || 0) === 0) {
    console.log("No USDC found in portfolio. Skipping new trades.");
    return;
  }

  for (const opportunity of opportunities) {
    if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) break;
    if (tradeManager.getOpenTrades().some(trade => trade.toTokenSymbol === opportunity.symbol)) {
      console.log(`Skipping trade for ${opportunity.symbol.toUpperCase()}: Already have an open trade for this symbol.`);
      continue;
    }

    // Confidence check is now done in runTradingCycle based on override setting
    const confidence = opportunity.aiConfidence !== undefined ? opportunity.aiConfidence : 0; // Use stored confidence

    let fromTokenAddress: string;
    let fromChain: string;
    let fromSpecificChain: string;
    let availableCapital: number;

    if (opportunity.chain === 'svm') {
        fromTokenAddress = USDC_SVM_ADDRESS;
        fromChain = 'svm';
        fromSpecificChain = 'svm';
        availableCapital = portfolio.tokens.find((token: any) => token.token === USDC_SVM_ADDRESS && token.chain === 'svm')?.amount || 0;
    } else {
        // Calculate total available USDC across all EVM chains
        const totalEvmUsdcBalance = Array.from(tradeableEvmUsdcBalances.values()).reduce((sum, balanceInfo) => sum + balanceInfo.amount, 0);
        availableCapital = totalEvmUsdcBalance;

        let foundEvmChainForTrade = false;
        const preferredEvmChains = [opportunity.specificChain, 'base', 'polygon', 'arbitrum', 'optimism']; // Order of preference

        for (const chain of preferredEvmChains) {
            const evmBalanceInfo = tradeableEvmUsdcBalances.get(chain);
            if (evmBalanceInfo && evmBalanceInfo.amount > 0) { // Check if there's any balance on this chain
                fromTokenAddress = evmBalanceInfo.address;
                fromChain = 'evm';
                fromSpecificChain = chain;
                foundEvmChainForTrade = true;
                break;
            }
        }

        if (!foundEvmChainForTrade) {
            console.log(`No USDC balance found on any preferred EVM chain for ${opportunity.symbol.toUpperCase()}. Skipping trade.`);
            continue; // Skip to the next opportunity if no suitable balance is found
        }
    }

    if (availableCapital === 0) {
        console.log(`No ${fromChain.toUpperCase()} USDC found in portfolio for ${opportunity.symbol.toUpperCase()}. Skipping trade.`);
        continue;
    }

    const positionSize = calculatePositionSize(availableCapital, 0.5);
    const reason = `AI-driven momentum trade. Confidence: ${(confidence * 100).toFixed(0)}%.`;

    console.log(`Executing entry for ${opportunity.symbol.toUpperCase()} with size ${positionSize.toFixed(2)} ${fromChain.toUpperCase()} USDC.`);
    try {
      await recall.executeTrade({
        fromToken: fromTokenAddress,
        toToken: opportunity.address,
        amount: positionSize.toString(),
        reason: reason,
        chain: fromChain,
        specificChain: fromSpecificChain,
      });
      // Add the new trade to our local tracking
      await tradeManager.addOpenTrade({
        id: Date.now().toString() + Math.random().toString(36).substring(2, 15),
        fromToken: fromTokenAddress,
        fromTokenSymbol: "USDC",
        fromChain: fromChain,
        fromSpecificChain: fromSpecificChain,
        fromAmount: positionSize,
        toToken: opportunity.address,
        toTokenSymbol: opportunity.symbol,
        toChain: opportunity.chain,
        toSpecificChain: opportunity.specificChain,
        toAmount: (positionSize / opportunity.current_price).toString(),
        price: opportunity.current_price,
        tradeAmountUsd: positionSize,
        timestamp: new Date().toISOString(),
        competitionId: "N/A",
        agentId: "N/A",
        reason: reason,
      });
    } catch (error) {
      console.error(`Error executing trade for ${opportunity.symbol.toUpperCase()}:`, error);
    }
  }
}

// --- AI and Performance ---
async function getTradeConfidence(analyzedToken: AnalyzedToken): Promise<number> {
    const { id, symbol, indicators, price_change_percentage_1h_in_currency, total_volume, market_cap, isOpportunity, bollingerBands,current_price } = analyzedToken;
    
    let prompt = `\nAnalyze the current state of ${symbol.toUpperCase()} based on the following technical indicators and market data. Provide a confidence score from 0.0 to 1.0 for a potential BUY trade. A score of 1.0 represents maximum confidence. Return ONLY the numeric score, enclosed within <score> tags (e.g., <score>0.85</score>). You may also provide additional explanatory text outside these tags.\n\nTechnical Indicators (Hourly Chart):\n- Current Price: ${analyzedToken.current_price.toFixed(4)}\n- Bollinger Bands: Price is ${indicators.priceAtLowerBand ? 'AT OR BELOW' : 'ABOVE'} the lower band (Lower Band: ${bollingerBands.lower.toFixed(4)}).\n- RSI: ${indicators.rsi.toFixed(2)} (Moving Average: ${indicators.rsiMA.toFixed(2)}). RSI has ${indicators.rsiCrossedUp ? 'JUST CROSSED ABOVE' : 'NOT CROSSED ABOVE'} its Moving Average.\n- MACD: MACD Line: ${indicators.macdLine.toFixed(4)}, Signal Line: ${indicators.signalLine.toFixed(4)}. MACD has ${indicators.macdCrossedUp ? 'JUST CROSSED ABOVE' : 'NOT CROSSED ABOVE'} its Signal Line.\n\nAdditional Market Context:\n- Price Change (1h): ${price_change_percentage_1h_in_currency?.toFixed(4) || 'N/A'}%\n- Total Volume: ${total_volume.toLocaleString()}\n- Market Cap: ${market_cap.toLocaleString()}\n\n`;

    if (isOpportunity) {
        prompt += `\nBased on the bot's primary strategy, this token is currently identified as a HIGH-CONFIDENCE BUY OPPORTUNITY due to the confluence of all three bullish signals (RSI Crossover, Price at Lower Bollinger Band, MACD Crossover).\n`;
    } else {
        prompt += `\nBased on the bot's primary strategy, this token is NOT currently identified as a HIGH-CONFIDENCE BUY OPPORTUNITY. Please provide your independent assessment.\n`;
    }

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) {
            console.error(`Error fetching trade confidence for ${symbol.toUpperCase()}: ${response.statusText}`);
            return 0;
        }
        const result = await response.json();
        // Try to extract score from <score> tags first
        let scoreMatch = result.response.match(/<score>([0-9.]+)<\/score>/);
        let confidence = 0;

        if (scoreMatch && scoreMatch[1]) {
            confidence = parseFloat(scoreMatch[1]);
        } else {
            // If no <score> tags, try to extract from a sentence like "confidence score of X.X"
            scoreMatch = result.response.match(/confidence score of \*\*([0-9.]+)\*\*/);
            if (scoreMatch && scoreMatch[1]) {
                confidence = parseFloat(scoreMatch[1]);
            } else {
                console.error('Failed to parse confidence score from AI response. No <score> tags or recognized sentence pattern found.');
           //     console.log('AI Raw Response:', result.response);
                return 0;
            }
        }
        console.log(`AI confidence ${symbol.toUpperCase()}: ${confidence.toFixed(2)} Price:${current_price} RSI:${indicators.rsi.toFixed(2)} RSI_MA:${indicators.rsiMA.toFixed(2)} MACD:${indicators.macdLine.toFixed(4)} Signal:${indicators.signalLine.toFixed(4)} (Bot Opportunity: ${isOpportunity})`);
        
        return confidence;
    } catch (error) {
        console.error(`Error in getTradeConfidence for ${symbol.toUpperCase()}:`, error);
        return 0;
    }
}

function calculatePositionSize(availableCapital: number, volatility: number): number {
  const basePosition = availableCapital * strategyParameters.maxPositionSize;
  const adjustedSize = basePosition * (1 - volatility);
  return Math.max(10, adjustedSize);
}

async function trackPerformance() {
    console.log("\n--- Generating Performance Report ---");
    const [portfolio, trades] = await Promise.all([
        recall.getPortfolio(),
        recall.getAgentTrades()
    ]);

    if (portfolio && trades) {
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
  if (pnl < -0.1 && winRate < 0.5) {
    console.log("Performance is poor. Tightening risk parameters.");
    strategyParameters.maxPositionSize = 0.05;
    strategyParameters.stopLoss = 0.03;
  } else if (pnl > 0.1 && winRate > 0.6) {
    console.log("Performance is strong. Slightly increasing risk appetite.");
    strategyParameters.maxPositionSize = 0.12;
    strategyParameters.takeProfit = 0.20;
  }
}

function calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const profitableTrades = trades.filter(t => parseFloat(t.pnl) > 0).length;
    return (profitableTrades / trades.length) * 100;
}

// --- Start Bot ---
main();
