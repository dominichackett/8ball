
import 'dotenv/config';
import * as recall from '../providers/recall';
import * as dexscreener from '../memecoin_bot/providers/dexscreener';
import * as tradeManager from './solana_memecoin_trade_manager';
import { logTrade } from '../utils/logger';
import { Trade } from '../../types/api';

// --- Bot Configuration ---
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const POSITION_SIZE_USDC = 10; // Spend 10 USDC per trade
const TAKE_PROFIT_PERCENTAGE = 200; // 200% profit
const STOP_LOSS_PERCENTAGE = 50; // 50% loss
const MIN_LIQUIDITY_USDC = 5000; // Minimum $5k liquidity

// --- Main Application ---
async function main() {
  console.log('Starting Solana Memecoin Trading Bot...');
  await tradeManager.loadOpenTrades();

  // Run once immediately on startup
  await runTradingCycle();

  // Then, set up the interval for subsequent runs
  console.log(`Initialization complete. Bot will run every ${POLLING_INTERVAL / 60000} minutes.`);
  setInterval(runTradingCycle, POLLING_INTERVAL);
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running Solana Memecoin Trading Cycle ---');
  try {
    await monitorOpenPositions();
    await findAndExecuteNewTrades();
  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

async function findAndExecuteNewTrades() {
    console.log('Searching for new Solana meme coins...');
    try {
        const newPairs = await dexscreener.getNewPairs('solana');
        console.log(`Found ${newPairs.length} new pairs on Solana.`);

        for (const pair of newPairs) {
            if (tradeManager.getOpenTrades().some(t => t.toToken === pair.baseToken.address)) {
                console.log(`Already in a trade for ${pair.baseToken.symbol}, skipping.`);
                continue;
            }

            if (pair.liquidity.usd < MIN_LIQUIDITY_USDC) {
                console.log(`Skipping ${pair.baseToken.symbol} due to low liquidity: $${pair.liquidity.usd}`);
                continue;
            }

            console.log(`Executing BUY for ${pair.baseToken.symbol} with ${POSITION_SIZE_USDC} USDC.`);

            try {
                const tradeResult = await recall.executeTrade({
                    fromToken: USDC_SVM_ADDRESS,
                    toToken: pair.baseToken.address,
                    amount: POSITION_SIZE_USDC.toString(),
                    reason: 'Solana Memecoin Bot',
                    chain: 'svm',
                    specificChain: 'svm'
                });

                await tradeManager.addOpenTrade({
                    id: tradeResult.transaction.id,
                    fromToken: USDC_SVM_ADDRESS,
                    fromTokenSymbol: "USDC",
                    fromChain: 'svm',
                    fromSpecificChain: 'svm',
                    fromAmount: POSITION_SIZE_USDC,
                    toToken: pair.baseToken.address,
                    toTokenSymbol: pair.baseToken.symbol,
                    toChain: 'svm',
                    toSpecificChain: 'svm',
                    toAmount: tradeResult.transaction.toAmount,
                    oprice: pair.priceUsd,
                    price: pair.priceUsd,
                    tprice: tradeResult.transaction.price,
                    tradeAmountUsd: POSITION_SIZE_USDC,
                    timestamp: new Date().toISOString(),
                    competitionId: "N/A",
                    agentId: "N/A",
                    reason: 'Solana Memecoin Bot'
                });
                console.log(`Successfully opened position for ${pair.baseToken.symbol}.`);
                await logTrade(`OPENED: ${pair.baseToken.symbol.toUpperCase()} - Amount: ${tradeResult.transaction.toAmount} - Price: ${pair.priceUsd} - Reason: Solana Memecoin Bot`);

            } catch (error) {
                console.error(`Error executing trade for ${pair.baseToken.symbol}:`, error);
            }
        }
    } catch (error) {
        console.error('Error finding new pairs:', error);
    }
}

async function monitorOpenPositions() {
    const openTrades = tradeManager.getOpenTrades();
    if (openTrades.length === 0) return;

    console.log(`Monitoring ${openTrades.length} open positions...`);

    for (const trade of openTrades) {
        try {
            const priceResponse = await dexscreener.getPairPrice(trade.toToken);
            if (!priceResponse) {
                console.log(`Could not get price for ${trade.toTokenSymbol}, skipping.`);
                continue;
            }

            const currentPrice = parseFloat(priceResponse.priceUsd);
            const pnlPercentage = ((currentPrice - trade.price) / trade.price) * 100;

            console.log(`  - ${trade.toTokenSymbol}: Current Price: $${currentPrice.toFixed(6)}, PnL: ${pnlPercentage.toFixed(2)}%`);

            if (pnlPercentage >= TAKE_PROFIT_PERCENTAGE || pnlPercentage <= -STOP_LOSS_PERCENTAGE) {
                const reason = pnlPercentage >= TAKE_PROFIT_PERCENTAGE ? 'Take-profit' : 'Stop-loss';
                console.log(`Exit condition met for ${trade.toTokenSymbol}: ${reason}.`);

                try {
                    await recall.executeTrade({
                        fromToken: trade.toToken,
                        toToken: USDC_SVM_ADDRESS,
                        amount: trade.toAmount,
                        reason,
                        chain: 'svm',
                        specificChain: 'svm'
                    });
                    await tradeManager.removeOpenTrade(trade.id);
                    console.log(`Closed position for ${trade.toTokenSymbol}.`);
                    await logTrade(`CLOSED: ${trade.toTokenSymbol.toUpperCase()} - Open Price: ${trade.price.toFixed(6)} - Close Price: ${currentPrice.toFixed(6)} - PnL: ${pnlPercentage.toFixed(2)}% - Reason: ${reason}`);
                } catch (error) {
                    console.error(`Error closing position for ${trade.toTokenSymbol}:`, error);
                }
            }
        } catch (error) {
            console.error(`Error monitoring position for ${trade.toTokenSymbol}:`, error);
        }
    }
}

main();
