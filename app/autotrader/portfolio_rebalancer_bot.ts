import 'dotenv/config';
import * as recall from './providers/recall';
import * as coingecko from './providers/coingecko';
import * as tradeManager from './intraday_trade_manager'; // Reusing for trade logging

// --- Bot Configuration ---
const POLLING_INTERVAL = 300000; // 5 minutes for rebalancing checks
const HISTORICAL_REFRESH_INTERVAL = 3600000; // 1 hour (less frequent needed for rebalancing)
const PERFORMANCE_TRACKING_INTERVAL = 3600000 * 6; // 6 hours

const TRADE_EXECUTION_ENABLED = process.env.TRADING_ENABLED === 'true';

// --- Global Configuration ---
let AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.70');

// --- Token & Strategy Configuration ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string; coingeckoId: string }>();
const TRADABLE_TOKEN_ADDRESSES = new Set<string>();

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC on Ethereum
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on SVM

let strategyParameters = {
    maxConcurrentPositions: 5, // Still useful for general trade limits
    REBALANCE_THRESHOLD_PERCENTAGE: 1.0, // Rebalance if allocation deviates by 1%
    MIN_TRADE_AMOUNT_USD: 50, // Minimum trade size in USD to avoid tiny trades
    TARGET_ALLOCATIONS: new Map<string, number>(), // symbol -> percentage
};

// --- Main Application ---
async function main() {
  console.log('Starting Portfolio Rebalancer Bot...');
  await tradeManager.loadOpenTrades();
  initializeTradableTokens();
  initializeTargetAllocations();

  await runRebalancingCycle(); // Run immediately on startup
  setInterval(runRebalancingCycle, POLLING_INTERVAL);
  setInterval(trackPerformance, PERFORMANCE_TRACKING_INTERVAL);

  console.log('Bot is running. Monitoring portfolio for rebalancing opportunities.');
}

function initializeTradableTokens() {
    console.log('Initializing tradable tokens for rebalancing...');
    TRADABLE_TOKENS.set('wrapped-bitcoin', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chain: 'evm', specificChain: 'eth', symbol: 'WBTC', coingeckoId: 'wrapped-bitcoin' });
    TRADABLE_TOKEN_ADDRESSES.add('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
    TRADABLE_TOKENS.set('weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'evm', specificChain: 'eth', symbol: 'WETH', coingeckoId: 'ethereum' });
    TRADABLE_TOKEN_ADDRESSES.add('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
    TRADABLE_TOKENS.set('solana', { address: 'So11111111111111111111111111111111111111112', chain: 'svm', specificChain: 'svm', symbol: 'SOL', coingeckoId: 'solana' });
    TRADABLE_TOKEN_ADDRESSES.add('So11111111111111111111111111111111111111112');
    TRADABLE_TOKENS.set('chainlink', { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'evm', specificChain: 'eth', symbol: 'LINK', coingeckoId: 'chainlink' });
    TRADABLE_TOKEN_ADDRESSES.add('0x514910771af9ca656af840dff83e8264ecf986ca');
    TRADABLE_TOKENS.set('bonk', { address: '0x1151cb3d861920e07a38e03eead12c32178567f6', chain: 'evm', specificChain: 'eth', symbol: 'BONK', coingeckoId: 'bonk' });
    TRADABLE_TOKEN_ADDRESSES.add('0x1151cb3d861920e07a38e03eead12c32178567f6');
    TRADABLE_TOKENS.set('pepe', { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'evm', specificChain: 'eth', symbol: 'PEPE', coingeckoId: 'pepe' });
    TRADABLE_TOKEN_ADDRESSES.add('0x6982508145454ce325ddbe47a25d4ec3d2311933');
    console.log(`Initialization complete. ${TRADABLE_TOKENS.size} tokens are tradable.`);
}

function initializeTargetAllocations() {
    strategyParameters.TARGET_ALLOCATIONS.set('WBTC', 0.30);
    strategyParameters.TARGET_ALLOCATIONS.set('WETH', 0.30);
    strategyParameters.TARGET_ALLOCATIONS.set('SOL', 0.20);
    strategyParameters.TARGET_ALLOCATIONS.set('LINK', 0.10);
    strategyParameters.TARGET_ALLOCATIONS.set('BONK', 0.05);
    strategyParameters.TARGET_ALLOCATIONS.set('PEPE', 0.05);
    console.log('Target allocations set.', Array.from(strategyParameters.TARGET_ALLOCATIONS.entries()));
}

// --- Core Bot Logic ---
async function runRebalancingCycle() {
  console.log('\n--- Running Portfolio Rebalancing Cycle ---');
  try {
    const [portfolio, marketData] = await Promise.all([
      recall.getPortfolio(),
      coingecko.getMarketData({ vs_currency: 'usd', ids: Array.from(TRADABLE_TOKENS.values()).map(t => t.coingeckoId).join(',') }),
    ]);

    if (!portfolio || !marketData || marketData.length === 0) {
      console.error("Could not fetch portfolio or market data. Skipping cycle.");
      return;
    }

    // Monitor open positions (no-op for rebalancer, but keeps structure)
    monitorOpenPositions();

    const currentPortfolioValue = portfolio.totalValue;
    if (currentPortfolioValue === 0) {
        console.log("Portfolio value is zero. Cannot rebalance.");
        return;
    }

    const currentAllocations = new Map<string, { value: number, percentage: number, amount: number, price: number, address: string, chain: string, specificChain: string }>();
    let totalTradableValue = 0;

    // Calculate current allocations and total tradable value
    for (const token of portfolio.tokens) {
        const tradableTokenInfo = Array.from(TRADABLE_TOKENS.values()).find(t => t.address.toLowerCase() === token.token.toLowerCase());
        if (tradableTokenInfo) {
            const marketPrice = marketData.find((md: any) => md.id === tradableTokenInfo.coingeckoId)?.current_price;
            if (marketPrice) {
                const tokenValue = token.amount * marketPrice;
                totalTradableValue += tokenValue;
                currentAllocations.set(tradableTokenInfo.symbol, {
                    value: tokenValue,
                    percentage: 0, // Will calculate later
                    amount: token.amount,
                    price: marketPrice,
                    address: tradableTokenInfo.address,
                    chain: tradableTokenInfo.chain,
                    specificChain: tradableTokenInfo.specificChain,
                });
            }
        } else if ((token.token.toLowerCase() === USDC_ADDRESS.toLowerCase() || token.token.toLowerCase() === USDC_SVM_ADDRESS.toLowerCase()) && token.amount > 0) {
            // Include USDC in total portfolio value for allocation calculation
            totalTradableValue += token.amount;
            currentAllocations.set('USDC', {
                value: token.amount,
                percentage: 0,
                amount: token.amount,
                price: 1, // USDC price is 1
                address: token.token,
                chain: token.chain,
                specificChain: token.specificChain,
            });
        }
    }

    // Recalculate percentages based on totalTradableValue
    for (const [symbol, data] of currentAllocations.entries()) {
        data.percentage = (data.value / totalTradableValue) * 100;
    }

    console.log('Current Portfolio Allocations:');
    currentAllocations.forEach((data, symbol) => {
        console.log(`  ${symbol}: ${data.percentage.toFixed(2)}% (Value: ${data.value.toFixed(2)} USD)`);
    });

    const rebalancingTrades: { symbol: string; type: 'buy' | 'sell'; amountUsd: number; tokenInfo: any; currentPrice: number }[] = [];

    // Identify rebalancing opportunities
    for (const [symbol, targetPercentage] of strategyParameters.TARGET_ALLOCATIONS.entries()) {
        const current = currentAllocations.get(symbol);
        const currentPercentage = current ? current.percentage : 0;
        const targetValue = totalTradableValue * targetPercentage;

        const deviation = currentPercentage - (targetPercentage * 100);

        if (Math.abs(deviation) > strategyParameters.REBALANCE_THRESHOLD_PERCENTAGE) {
            const amountToTradeUsd = Math.abs(targetValue - (current ? current.value : 0));

            if (amountToTradeUsd < strategyParameters.MIN_TRADE_AMOUNT_USD) {
                console.log(`Skipping ${symbol}: Trade amount (${amountToTradeUsd.toFixed(2)} USD) too small.`);
                continue;
            }

            if (deviation > 0) { // Over-allocated, need to sell
                rebalancingTrades.push({
                    symbol,
                    type: 'sell',
                    amountUsd: amountToTradeUsd,
                    tokenInfo: TRADABLE_TOKENS.get(symbol.toLowerCase()), // Use symbol to get tokenInfo
                    currentPrice: current?.price || 0,
                });
            } else { // Under-allocated, need to buy
                rebalancingTrades.push({
                    symbol,
                    type: 'buy',
                    amountUsd: amountToTradeUsd,
                    tokenInfo: TRADABLE_TOKENS.get(symbol.toLowerCase()), // Use symbol to get tokenInfo
                    currentPrice: current ? current.price : marketData.find((md: any) => md.id === TRADABLE_TOKENS.get(symbol.toLowerCase())?.coingeckoId)?.current_price || 0,
                });
            }
        }
    }

    console.log(`Found ${rebalancingTrades.length} rebalancing trades.`);
    await executeRebalancingTrades(rebalancingTrades, currentAllocations);

  } catch (error) {
    console.error('Error in rebalancing cycle:', error);
  }
}

function monitorOpenPositions() {
    // This bot does not use monitorOpenPositions for trailing stops, so it's a no-op.
    // We keep the function for structural consistency with other bots.
}

async function executeRebalancingTrades(trades: any[], currentAllocations: Map<string, any>) {
    const FIXED_POSITION_SIZE = 1000; // This is not used for rebalancing, but kept for consistency

    for (const trade of trades) {
        if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) {
            console.log("Max concurrent positions reached. Cannot execute more rebalancing trades.");
            break;
        }

        const fromTokenAddress = trade.type === 'buy' ? (trade.tokenInfo.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS) : trade.tokenInfo.address;
        const toTokenAddress = trade.type === 'buy' ? trade.tokenInfo.address : (trade.tokenInfo.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS);
        const amountToTradeUsd = trade.amountUsd; // This is in USD
        const reason = `Portfolio Rebalance: ${trade.type.toUpperCase()} ${trade.symbol}. AI Conf: ${(trade.aiConfidence! * 100).toFixed(0)}%`;

        // AI Confirmation
        const aiConfidence = await getRebalanceConfidence(trade);
        if (aiConfidence < AI_CONFIDENCE_THRESHOLD) {
            console.log(`Skipping rebalance trade for ${trade.symbol} (${trade.type}): AI confidence (${aiConfidence.toFixed(2)}) below threshold.`);
            continue;
        }

        console.log(`Attempting to ${trade.type} ${trade.symbol} for ${amountToTradeUsd.toFixed(2)} USD.`);

        if (TRADE_EXECUTION_ENABLED) {
            try {
                let actualAmount;
                if (trade.type === 'sell') {
                    const currentTokenAmount = currentAllocations.get(trade.symbol)?.amount || 0;
                    // Calculate the token amount to sell based on USD value, but don't sell more than held
                    actualAmount = Math.min(currentTokenAmount, amountToTradeUsd / trade.currentPrice);
                    if (actualAmount * trade.currentPrice < strategyParameters.MIN_TRADE_AMOUNT_USD) {
                        console.log(`Skipping sell for ${trade.symbol}: Calculated token amount (${actualAmount.toFixed(4)}) too small.`);
                        continue;
                    }
                } else { // Buy
                    actualAmount = amountToTradeUsd; // Amount to send in USDC
                }

                await recall.executeTrade({
                    fromToken: fromTokenAddress,
                    toToken: toTokenAddress,
                    amount: actualAmount.toString(),
                    reason: reason,
                    chain: trade.tokenInfo.chain,
                    specificChain: trade.tokenInfo.specificChain,
                });

                // Log the trade in tradeManager
                await tradeManager.addOpenTrade({
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 15),
                    fromToken: fromTokenAddress,
                    fromTokenSymbol: trade.type === 'buy' ? 'USDC' : trade.symbol,
                    fromChain: trade.type === 'buy' ? (trade.tokenInfo.chain === 'svm' ? 'svm' : 'evm') : trade.tokenInfo.chain,
                    fromSpecificChain: trade.type === 'buy' ? (trade.tokenInfo.chain === 'svm' ? 'svm' : 'eth') : trade.tokenInfo.specificChain, // Default to eth for EVM USDC
                    fromAmount: trade.type === 'buy' ? amountToTradeUsd : actualAmount,
                    toToken: toTokenAddress,
                    toTokenSymbol: trade.type === 'buy' ? trade.symbol : 'USDC',
                    toChain: trade.type === 'buy' ? trade.tokenInfo.chain : (trade.tokenInfo.chain === 'svm' ? 'svm' : 'evm'),
                    toSpecificChain: trade.type === 'buy' ? trade.tokenInfo.specificChain : (trade.tokenInfo.chain === 'svm' ? 'svm' : 'eth'), // Default to eth for EVM USDC
                    toAmount: trade.type === 'buy' ? (amountToTradeUsd / trade.currentPrice).toString() : actualAmount.toString(),
                    price: trade.currentPrice,
                    tradeAmountUsd: amountToTradeUsd,
                    timestamp: new Date().toISOString(),
                    competitionId: "N/A",
                    agentId: "N/A",
                    reason: reason,
                });
                console.log(`SUCCESS: Rebalance trade executed for ${trade.symbol} (${trade.type}).`);
            } catch (error) {
                console.error(`Error executing rebalance trade for ${trade.symbol} (${trade.type}):`, error);
            }
        } else {
            console.log(`DRY RUN: Rebalance trade for ${trade.symbol} (${trade.type}) was identified but not executed.`);
        }
    }
}

async function getRebalanceConfidence(trade: any): Promise<number> {
    const { symbol, type, amountUsd, tokenInfo, currentPrice } = trade;
    const currentAllocation = strategyParameters.TARGET_ALLOCATIONS.get(symbol);

    let prompt = `Analyze this proposed portfolio rebalancing trade. Provide a confidence score from 0.0 to 1.0. Return ONLY the numeric score, enclosed within <score> tags.\n\n`;
    prompt += `Proposed Action: ${type.toUpperCase()} ${symbol} (Coingecko ID: ${tokenInfo.coingeckoId}) for ${amountUsd.toFixed(2)} USD.\n`;
    prompt += `Current Price: ${currentPrice.toFixed(4)} USD.\n`;
    prompt += `Target Allocation for ${symbol}: ${(currentAllocation! * 100).toFixed(2)}%.\n`;
    prompt += `This trade is to bring the portfolio back to its target allocation.\n\n`;
    prompt += `Consider if this is a good time to execute this rebalance given current market conditions (e.g., extreme volatility, sudden price spikes/drops that might make rebalancing less optimal).`;

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) {
            console.error(`AI API Error for rebalance confidence: ${response.statusText}`);
            return 0;
        }
        const result = await response.json();
        const scoreMatch = result.response.match(/<score>([0-9.]+)<!--\/score-->/);
        if (scoreMatch && scoreMatch[1]) {
            const confidence = parseFloat(scoreMatch[1]);
            console.log(`AI confidence for rebalance ${type} ${symbol}: ${confidence.toFixed(2)}`);
            return confidence;
        }
        console.error(`Failed to parse AI score for rebalance ${type} ${symbol}.`);
        return 0;
    } catch (error) {
        console.error(`Error in getRebalanceConfidence for ${symbol}:`, error);
        return 0;
    }
}

async function trackPerformance() {
    console.log("\n--- Generating Performance Report (Rebalancer) ---");
    const [portfolio, trades] = await Promise.all([
        recall.getPortfolio(),
        recall.getAgentTrades()
    ]);

    if (portfolio && trades) {
        // For a rebalancer, PnL is less about individual trades and more about overall portfolio value.
        // We can track total portfolio value over time.
        console.log(`  Current Portfolio Value: ${portfolio.totalValue.toFixed(2)} USD`);
        console.log(`  Total Trades Executed: ${trades.trades.length}`);
        // Win rate is not directly applicable to rebalancing trades in the same way as speculative trades.
        // You'd typically look at overall portfolio growth vs. a benchmark.
    }
}

// --- Start Bot ---
main();