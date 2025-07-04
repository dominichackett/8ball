import 'dotenv/config';
import { recallActionProvider } from '../api/agent/recall_action_provider';
import { coingeckoActionProvider } from '../api/agent/coingecko_action_provider';

// Bot Configuration
const POLLING_INTERVAL = 30000; // 30 seconds
const HISTORICAL_DATA_INTERVAL = 5 * 60 * 1000; // 5 minutes
const ARBITRAGE_SCAN_INTERVAL = 15 * 60 * 1000; // 15 minutes
const PERFORMANCE_TRACKING_INTERVAL = 60 * 60 * 1000; // 1 hour

const recallProvider = recallActionProvider();
const coingeckoProvider = coingeckoActionProvider();

// --- State Management ---
let strategyParameters = {
    entryRsi: 60,
    exitRsi: 80,
    maxPositionSize: 0.1, // 10% of portfolio
    stopLoss: 0.05, // 5%
    takeProfit: 0.15, // 15%
    maxConcurrentPositions: 5,
    dailyLossLimit: -0.2, // -20%
    volumeMultiplier: 2, // 2x average volume
};

// --- Main Application ---
async function main() {
  console.log('Starting Autonomous Trading Bot...');

  // Initial data fetch
  await fetchHistoricalData();

  // Setup main loops
  setInterval(runTradingCycle, POLLING_INTERVAL);
  setInterval(fetchHistoricalData, HISTORICAL_DATA_INTERVAL);
  setInterval(scanForArbitrage, ARBITRAGE_SCAN_INTERVAL);
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);

  console.log('Bot is running. Polling for opportunities...');
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Trading Cycle ---');
  try {
    const [portfolio, marketData, trendingTokens, topMovers] = await Promise.all([
      recallProvider.getPortfolio(),
      coingeckoProvider.getMarketData({ vsCurrency: 'usd', perPage: 100 }),
      coingeckoProvider.getTrendingTokens({}),
      coingeckoProvider.getTopGainersLosers({ vsCurrency: 'usd', duration: '24h' })
    ]);

    if (!portfolio.success) {
        console.error("Could not fetch portfolio. Skipping cycle.");
        return;
    }
    
    // 1. Monitor existing positions for exit signals
    await monitorOpenPositions(portfolio.portfolio);

    // 2. Check risk limits before entering new trades
    if (portfolio.portfolio.positions.length >= strategyParameters.maxConcurrentPositions) {
      console.log('Max concurrent positions reached.');
      return;
    }
    if (portfolio.portfolio.pnl_24h <= strategyParameters.dailyLossLimit) {
      console.log('Daily loss limit reached. No new trades will be executed.');
      return;
    }

    // 3. Analyze for new opportunities
    const opportunities = analyzeMomentumOpportunities(marketData, trendingTokens, topMovers);
    console.log(`Found ${opportunities.length} potential opportunities.`);

    // 4. Execute new trades
    await executeTrades(opportunities, portfolio.portfolio);

  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

// --- Data Fetching and Analysis ---
async function fetchHistoricalData() {
  console.log('Fetching historical data for technical indicators...');
  try {
    const marketData = await coingeckoProvider.getMarketData({ vsCurrency: 'usd', perPage: 50 });
    if (marketData.success) {
      for (const coin of marketData.data) {
        const historicalData = await coingeckoProvider.getHistoricalChart({ coinId: coin.id, vsCurrency: 'usd', days: 30 });
        if (historicalData.success) {
          const prices = historicalData.data.prices.map((p: any) => p[1]);
          // In a real bot, you would store these indicators in a state manager/cache
          const rsi = calculateRSI(prices);
          const macd = calculateMACD(prices);
          // console.log(`Indicators for ${coin.symbol.toUpperCase()}: RSI=${rsi.toFixed(2)}`);
        }
      }
    }
  } catch (error) {
      console.error("Error fetching historical data:", error);
  }
}

function analyzeMomentumOpportunities(marketData: any, trendingTokens: any, topMovers: any): any[] {
    if (!marketData.success || !trendingTokens.success || !topMovers.success) {
        return [];
    }

    const trendingIds = new Set(trendingTokens.data.coins.map((c: any) => c.item.id));
    const topGainerIds = new Set(topMovers.data.gainers.map((c: any) => c.id));
    let opportunities: any[] = [];

    for (const coin of marketData.data) {
        const priceChange1h = coin.price_change_percentage_1h_in_currency;
        const isTrending = trendingIds.has(coin.id) || topGainerIds.has(coin.id);
        
        // Simplified volume spike check
        const volumeSpike = coin.total_volume > (coin.market_cap / 10); 

        if (priceChange1h > 5 && volumeSpike && isTrending) {
            opportunities.push(coin);
        }
    }
    return opportunities;
}

async function scanForArbitrage() {
  console.log('Scanning for cross-chain arbitrage opportunities...');
  const tokens = [
      { symbol: 'WBTC', eth: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', poly: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6' },
      { symbol: 'WETH', eth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', poly: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619' }
  ];

  for (const token of tokens) {
      const [ethPriceResult, polygonPriceResult] = await Promise.all([
          recallProvider.getPrice({ token: token.eth, chain: 'evm', specificChain: 'eth' }),
          recallProvider.getPrice({ token: token.poly, chain: 'evm', specificChain: 'polygon' })
      ]);

      if (ethPriceResult.success && polygonPriceResult.success) {
          const ethPrice = ethPriceResult.price.price;
          const polygonPrice = polygonPriceResult.price.price;
          const priceDiff = (ethPrice - polygonPrice) / polygonPrice;

          if (Math.abs(priceDiff) > 0.02) { // 2% price difference threshold
              console.log(`Arbitrage opportunity found for ${token.symbol}! Diff: ${(priceDiff * 100).toFixed(2)}%`);
              // In a real bot, you would calculate the potential profit considering gas fees and execute the trade.
          }
      }
  }
}


// --- Trade Execution and Management ---
async function monitorOpenPositions(portfolio: any) {
  console.log("Monitoring open positions...");
  for (const position of portfolio.positions) {
    const currentPriceResult = await recallProvider.getPrice({ token: position.tokenAddress, chain: 'evm', specificChain: 'eth' }); // Assuming positions are on ETH
    if (currentPriceResult.success) {
      const currentPrice = currentPriceResult.price.price;
      const entryPrice = position.entry_price;
      const pnl = (currentPrice - entryPrice) / entryPrice;

      const stopLossHit = pnl <= -strategyParameters.stopLoss;
      const takeProfitHit = pnl >= strategyParameters.takeProfit;

      if (stopLossHit || takeProfitHit) {
        const reason = stopLossHit ? 'Stop-loss triggered' : 'Take-profit triggered';
        console.log(`Executing exit for ${position.symbol}: ${reason}`);
        await recallProvider.executeTrade({
          fromToken: position.symbol.toUpperCase(),
          toToken: 'USDC',
          amount: position.amount.toString(),
          reason: reason,
          slippageTolerance: '1', // 1% slippage for exits
        });
      }
    }
  }
}

async function executeTrades(opportunities: any[], portfolio: any) {
  console.log("Executing new trades...");
  const availableCapital = parseFloat(portfolio.balance);

  for (const opportunity of opportunities) {
    if (portfolio.positions.length >= strategyParameters.maxConcurrentPositions) break;

    const confidence = await getTradeConfidence(opportunity);
    if (confidence < 0.75) continue; // AI confidence threshold

    if (opportunity.total_volume < 1000000) continue; // Liquidity check

    const positionSize = calculatePositionSize(availableCapital, 0.5, confidence); // volatility placeholder
    const reason = `AI-driven momentum trade. Confidence: ${(confidence * 100).toFixed(0)}%.`;

    console.log(`Executing entry for ${opportunity.symbol.toUpperCase()} with size ${positionSize.toFixed(2)} USDC.`);
    await recallProvider.executeTrade({
      fromToken: 'USDC',
      toToken: opportunity.symbol.toUpperCase(),
      amount: positionSize.toString(),
      reason: reason,
      slippageTolerance: '2',
    });
  }
}

// --- AI and Performance ---
async function getTradeConfidence(opportunity: any): Promise<number> {
  // Placeholder for a call to a real AI model.
  // This would analyze all available data (indicators, market sentiment, etc.)
  console.log(`AI analyzing opportunity for ${opportunity.symbol.toUpperCase()}...`);
  return 0.7 + Math.random() * 0.25; // Return a high confidence score for simulation
}

function calculatePositionSize(availableCapital: number, volatility: number, confidence: number): number {
  const basePosition = availableCapital * strategyParameters.maxPositionSize;
  const adjustedSize = basePosition * (1 - volatility) * confidence;
  return Math.max(10, adjustedSize); // Ensure a minimum trade size
}

async function trackPerformance() {
    console.log("\n--- Generating Performance Report ---");
    const [portfolio, trades] = await Promise.all([
        recallProvider.getPortfolio(),
        recallProvider.getAgentTrades()
    ]);

    if (portfolio.success && trades.success) {
        const pnl = (portfolio.portfolio.balance / 10000) - 1; // Assuming 10k starting capital
        const winRate = calculateWinRate(trades.trades);
        console.log(`  Portfolio Value: $${portfolio.portfolio.balance.toFixed(2)}`);
        console.log(`  Total PnL: ${(pnl * 100).toFixed(2)}%`);
        console.log(`  Win Rate: ${winRate.toFixed(2)}%`);
        
        // Adapt strategy based on performance
        adaptStrategy(pnl, winRate);
    }
}

function adaptStrategy(pnl: number, winRate: number) {
  console.log("Adapting strategy based on performance...");
  // This is a simplified rule-based adaptation. A real bot would use a more sophisticated model.
  if (pnl < -0.1 && winRate < 0.5) {
    console.log("Performance is poor. Tightening risk parameters.");
    strategyParameters.maxPositionSize = 0.05; // Reduce size
    strategyParameters.stopLoss = 0.03; // Tighter stop-loss
  } else if (pnl > 0.1 && winRate > 0.6) {
    console.log("Performance is strong. Slightly increasing risk appetite.");
    strategyParameters.maxPositionSize = 0.12;
    strategyParameters.takeProfit = 0.20;
  }
}

// --- Utility and Helper Functions ---
function getTokenAddress(token: string): string {
    const tokenMap: { [key: string]: string } = {
        'WBTC': '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
        'WETH': '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    };
    return tokenMap[token] || '';
}

function calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const profitableTrades = trades.filter(t => parseFloat(t.pnl) > 0).length;
    return (profitableTrades / trades.length) * 100;
}

// --- Technical Indicator Calculations (Simplified) ---
function calculateRSI(prices: number[], period = 14): number {
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i-1];
        if (diff >= 0) {
            gains += diff;
        } else {
            losses -= diff;
        }
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9): any {
    // This is a highly simplified placeholder. A real implementation is more complex.
    const shortEMA = prices.slice(-shortPeriod).reduce((a,b) => a+b, 0) / shortPeriod;
    const longEMA = prices.slice(-longPeriod).reduce((a,b) => a+b, 0) / longPeriod;
    const macd = shortEMA - longEMA;
    return { macd: macd, signal: macd * 0.8 }; // Placeholder signal
}

// --- Start Bot ---
main();