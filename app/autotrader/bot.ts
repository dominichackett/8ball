import 'dotenv/config';
import * as recall from './providers/recall';
import { getAgentBalances } from './providers/recall';
import * as coingecko from './providers/coingecko';

// --- Bot Configuration ---
const POLLING_INTERVAL = 30000; // 30 seconds
const HISTORICAL_DATA_INTERVAL = 5 * 60 * 1000; // 5 minutes
const PERFORMANCE_TRACKING_INTERVAL = 60 * 60 * 1000; // 1 hour

const historicalPortfolioValues = new Map<number, number>(); // timestamp -> totalValue

// --- Token & Strategy Configuration ---
const TOKENS_TO_TRADE = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; }>([
    // Coingecko ID -> { address, chain, specificChain }
    ['wrapped-bitcoin', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chain: 'evm', specificChain: 'eth' }],
    ['weth', { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', chain: 'evm', specificChain: 'eth' }],
    ['chainlink', { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'evm', specificChain: 'eth' }],
    // Add other tokens the bot is allowed to trade here
]);

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // Assuming USDC on Ethereum

let strategyParameters = {
    maxPositionSize: 0.1, // 10% of portfolio
    stopLoss: 0.05, // 5%
    takeProfit: 0.15, // 15%
    maxConcurrentPositions: 10,
    dailyLossLimit: -0.2, // -20%
};

// --- Main Application ---
async function main() {
  console.log('Starting Autonomous Trading Bot...');
  setInterval(runTradingCycle, POLLING_INTERVAL);
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);
  setInterval(recordHistoricalPortfolioValue, HISTORICAL_DATA_INTERVAL); // Record historical data
  console.log('Bot is running. Polling for opportunities...');
}

async function recordHistoricalPortfolioValue() {
  try {
    const portfolio = await recall.getPortfolio();
    if (portfolio && portfolio.totalValue) {
      historicalPortfolioValues.set(Date.now(), portfolio.totalValue);
      // Clean up old entries (e.g., older than 24 hours)
      const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
      for (let timestamp of historicalPortfolioValues.keys()) {
        if (timestamp < twentyFourHoursAgo) {
          historicalPortfolioValues.delete(timestamp);
        }
      }
    }
  } catch (error) {
    console.error('Error recording historical portfolio value:', error);
  }
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Trading Cycle ---');
  try {
    const [portfolio, marketData, agentBalances] = await Promise.all([
      recall.getPortfolio(),
      coingecko.getMarketData({ vs_currency: 'usd', per_page: 100 }),
      getAgentBalances()
    ]);

    if (agentBalances) {
        console.log('Agent Balances:', agentBalances);
    }

    if (!portfolio) { // Check if portfolio data is null/undefined/empty
        console.error("Could not fetch portfolio. Skipping cycle.");
        return;
    }
    
    await monitorOpenPositions(portfolio);

    if (portfolio.tokens.length >= strategyParameters.maxConcurrentPositions) {
      console.log('Max concurrent positions reached.');
      return;
    }

    // Calculate 24-hour PnL
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    let initialValue24h = -1; // Sentinel value

    // Find the closest historical value to 24 hours ago
    let closestTimestamp = -1;
    for (let [timestamp, value] of historicalPortfolioValues.entries()) {
        if (timestamp >= twentyFourHoursAgo) {
            if (closestTimestamp === -1 || Math.abs(timestamp - twentyFourHoursAgo) < Math.abs(closestTimestamp - twentyFourHoursAgo)) {
                closestTimestamp = timestamp;
                initialValue24h = value;
            }
        }
    }

    if (initialValue24h !== -1 && portfolio.totalValue) {
        const pnl24h = (portfolio.totalValue - initialValue24h) / initialValue24h;
        if (pnl24h <= strategyParameters.dailyLossLimit) {
            console.log('Daily loss limit reached. No new trades will be executed.');
            return;
        }
    } else {
        console.log('Not enough historical data for 24h PnL calculation or portfolio totalValue is missing.');
    }
    
    const opportunities = analyzeMomentumOpportunities(marketData);
    console.log(`Found ${opportunities.length} potential opportunities.`);

    await executeTrades(opportunities, portfolio);

  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

// --- Data Analysis ---
function analyzeMomentumOpportunities(marketData: any): any[] {
    if (!marketData) return [];

    let opportunities = [];
    for (const coin of marketData) {
        // Filter for only the tokens we are configured to trade
        if (TOKENS_TO_TRADE.has(coin.id)) {
            const priceChange1h = coin.price_change_percentage_1h_in_currency;
            const volumeSpike = coin.total_volume > (coin.market_cap / 10); // Example volume spike logic

            if (priceChange1h > 5 && volumeSpike) {
                // Attach our address info to the opportunity object
                const tokenInfo = TOKENS_TO_TRADE.get(coin.id);
                opportunities.push({ ...coin, ...tokenInfo });
            }
        }
    }
    return opportunities;
}

// --- Trade Execution & Management ---
async function monitorOpenPositions(portfolio: any) {
  console.log("Monitoring open positions...");
  
  for (const token of portfolio.tokens) { // Iterate over tokens array
    // Assuming 'price' in the token object is the entry price for PnL calculation
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
          fromToken: token.token, // Use the address from the token object
          toToken: USDC_ADDRESS,
          amount: token.amount.toString(),
          reason: reason,
        });
      }
    }
  }
}

async function executeTrades(opportunities: any[], portfolio: any) {
  console.log("Executing new trades...");
  const availableCapital = parseFloat(portfolio.totalValue);

  for (const opportunity of opportunities) {
    if (portfolio.tokens.length >= strategyParameters.maxConcurrentPositions) break;

    const confidence = await getTradeConfidence(opportunity);
    if (confidence < 0.75) continue;

    if (opportunity.total_volume < 1000000) continue;

    const positionSize = calculatePositionSize(availableCapital, 0.5, confidence);
    const reason = `AI-driven momentum trade. Confidence: ${(confidence * 100).toFixed(0)}%.`;

    console.log(`Executing entry for ${opportunity.symbol.toUpperCase()} with size ${positionSize.toFixed(2)} USDC.`);
    await recall.executeTrade({
      fromToken: USDC_ADDRESS,
      toToken: opportunity.address, // Use the correct address from the opportunity object
      amount: positionSize.toString(),
      reason: reason,
    });
  }
}

// --- AI and Performance ---
async function getTradeConfidence(opportunity: any): Promise<number> {
  const prompt = `Analyze the following cryptocurrency opportunity and provide a confidence score from 0.0 to 1.0 for executing a trade. A score of 1.0 represents maximum confidence. Return only the numeric score.\n\nData:\n- Symbol: ${opportunity.symbol.toUpperCase()}\n- Price Change (1h): ${opportunity.price_change_percentage_1h_in_currency.toFixed(2)}%\n- Total Volume: $${opportunity.total_volume.toLocaleString()}\n- Market Cap: $${opportunity.market_cap.toLocaleString()}`;
  try {
    const response = await fetch('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userMessage: prompt }),
    });
    if (!response.ok) {
      console.error(`Error fetching trade confidence: ${response.statusText}`);
      return 0;
    }
    const result = await response.json();
    const confidence = parseFloat(result.response);
    if (isNaN(confidence)) {
      console.error('Failed to parse confidence score from AI response.');
      return 0;
    }
    return confidence;
  } catch (error) {
    console.error('Error in getTradeConfidence:', error);
    return 0;
  }
}

function calculatePositionSize(availableCapital: number, volatility: number, confidence: number): number {
  const basePosition = availableCapital * strategyParameters.maxPositionSize;
  const adjustedSize = basePosition * (1 - volatility) * confidence;
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