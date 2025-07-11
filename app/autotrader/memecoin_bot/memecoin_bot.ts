import 'dotenv/config';
import * as dexscreener from './providers/dexscreener';
import * as recall from '../providers/recall';
import * as tradeManager from './memecoin_trade_manager';
import { logTrade } from '../utils/logger';

const POLLING_INTERVAL = 15 * 60 * 1000; // 15 minutes
const POSITION_SIZE_USD = 25; // The amount in USD to spend on each trade
const MIN_LIQUIDITY_USD = 10000; // Minimum liquidity in USD for a token to be considered

async function main() {
    console.log('Starting Meme Coin Trading Bot...');
    await tradeManager.loadOpenTrades();
    
    // Run once immediately on startup
    await runMemeCoinCycle();

    // Then, set up the interval for subsequent runs
    setInterval(runMemeCoinCycle, POLLING_INTERVAL);
}

async function runMemeCoinCycle() {
    console.log('\n--- Running Meme Coin Discovery Cycle ---');
    try {
        // 1. DISCOVERY: Find trending tokens from an external source
        const trendingPairs = await dexscreener.getTopTrendingPairs({
            minLiquidity: MIN_LIQUIDITY_USD
        });

        if (!trendingPairs || trendingPairs.length === 0) {
            console.log('No new trending pairs found that meet the criteria.');
            return;
        }

        console.log(`Found ${trendingPairs.length} potential new pairs.`);

        for (const pair of trendingPairs) {
            // Avoid buying what you already hold
            if (tradeManager.hasOpenTrade(pair.tokenAddress)) {
                console.log(`Skipping ${pair.symbol}: Already have an open position.`);
                continue;
            }

            // New: Check if the price is below the threshold
            const MAX_PRICE = 0.001;
            if (pair.priceUsd >= MAX_PRICE) {
                console.log(`Skipping ${pair.symbol}: Price (${pair.priceUsd}) is not below ${MAX_PRICE}.`);
                continue;
            }

            // 2. EXECUTION: If checks pass, execute the trade
            const TRADING_ENABLED = process.env.TRADING_ENABLED === 'true';

            if (TRADING_ENABLED) {
                console.log(`Attempting to BUY trending meme coin: ${pair.symbol}`);
                try {
                    // NOTE: You need to specify your source of funds (USDC address)
                    const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // <--- IMPORTANT: Replace with your actual USDC address
                    
                    const tradeResult = await recall.executeTrade({
                        fromToken: USDC_ADDRESS,
                        toToken: pair.tokenAddress,
                        amount: POSITION_SIZE_USD.toString(),
                        reason: `Automated meme coin trade based on trending data.`,
                        chain: pair.chain,
                        specificChain: pair.specificChain
                    });

                    const tradeData = {
                        id: tradeResult.transaction.id,
                        toTokenSymbol: pair.symbol,
                        toTokenAddress: pair.tokenAddress,
                        amount: tradeResult.transaction.toAmount,
                        price: pair.priceUsd, // The price at the time of discovery
                        timestamp: new Date().toISOString(),
                        chain: pair.chain,
                        specificChain: pair.specificChain
                    };

                    await tradeManager.addOpenTrade(tradeData);
                    await logTrade(`OPENED: ${pair.symbol} - Amount: ${tradeData.amount} - Price: ${tradeData.price}`);
                    console.log(`Successfully executed BUY for ${pair.symbol}.`);

                } catch (error) {
                    console.error(`Failed to execute trade for ${pair.symbol}:`, error);
                }
            } else {
                console.log(`[TRADING DISABLED] Potential trade: BUY ${pair.symbol} at ${pair.priceUsd}`);
            }
        }
    } catch (error) {
        console.error('Error in meme coin trading cycle:', error);
    }
    
    // 3. RISK MANAGEMENT: Monitor open positions for exit conditions
    await monitorMemeCoinPositions();
}

async function monitorMemeCoinPositions() {
    const openTrades = tradeManager.getOpenTrades();
    if (openTrades.length === 0) {
        console.log('No open meme coin positions to monitor.');
        return;
    }

    console.log(`--- Monitoring ${openTrades.length} Open Meme Coin Positions ---`);

    for (const trade of openTrades) {
        try {
            const priceResult = await recall.getPrice({
                token: trade.toTokenAddress,
                chain: trade.chain,
                specificChain: trade.specificChain
            });

            if (!priceResult || !priceResult.price) {
                console.log(`Could not get current price for ${trade.toTokenSymbol}. Skipping.`);
                continue;
            }

            const currentPrice = priceResult.price;
            const pnlPercent = ((currentPrice - trade.price) / trade.price) * 100;

            console.log(`  - ${trade.toTokenSymbol}: Entry: $${trade.price.toFixed(6)}, Current: $${currentPrice.toFixed(6)}, PnL: ${pnlPercent.toFixed(2)}%`);

            // EXIT STRATEGY
            const TAKE_PROFIT_PERCENT = 900; // 10x gain
            const STOP_LOSS_PERCENT = -50;   // Sell after 50% loss

            if (pnlPercent >= TAKE_PROFIT_PERCENT || pnlPercent <= STOP_LOSS_PERCENT) {
                const reason = pnlPercent >= TAKE_PROFIT_PERCENT ? 'Take-Profit' : 'Stop-Loss';
                console.log(`Exit condition met for ${trade.toTokenSymbol}: ${reason}`);

                // NOTE: You need to specify your source of funds (USDC address)
                const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // <--- IMPORTANT: Replace with your actual USDC address

                await recall.executeTrade({
                    fromToken: trade.toTokenAddress,
                    toToken: USDC_ADDRESS,
                    amount: trade.amount,
                    reason: `Automated meme coin trade: ${reason}`,
                    chain: trade.chain,
                    specificChain: trade.specificChain
                });

                await tradeManager.removeOpenTrade(trade.id);
                await logTrade(`CLOSED: ${trade.toTokenSymbol} at ${currentPrice} for ${reason}. PnL: ${pnlPercent.toFixed(2)}%`);
            }
        } catch (error) {
            console.error(`Error monitoring position for ${trade.toTokenSymbol}:`, error);
        }
    }
}

main().catch(console.error);
