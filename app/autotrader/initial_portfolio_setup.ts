import 'dotenv/config';
import * as recall from './providers/recall';
import * as coingecko from './providers/coingecko';
import * as tradeManager from './intraday_trade_manager'; // Reusing for trade logging

// --- Bot Configuration ---
const TRADE_EXECUTION_ENABLED = process.env.TRADING_ENABLED === 'true';
const AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.70');
const MIN_TRADE_AMOUNT_USD = 50; // Minimum trade size in USD

// --- Token & Strategy Configuration (Copied from rebalancer for standalone execution) ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string; coingeckoId: string }>();
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC on Ethereum
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on SVM

const TARGET_ALLOCATIONS = new Map<string, number>(); // symbol -> percentage

function initializeTradableTokens() {
    TRADABLE_TOKENS.set('wrapped-bitcoin', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chain: 'evm', specificChain: 'eth', symbol: 'WBTC', coingeckoId: 'wrapped-bitcoin' });
    TRADABLE_TOKENS.set('weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'evm', specificChain: 'eth', symbol: 'WETH', coingeckoId: 'ethereum' });
    TRADABLE_TOKENS.set('solana', { address: 'So11111111111111111111111111111111111111112', chain: 'svm', specificChain: 'svm', symbol: 'SOL', coingeckoId: 'solana' });
    TRADABLE_TOKENS.set('chainlink', { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'evm', specificChain: 'eth', symbol: 'LINK', coingeckoId: 'chainlink' });
    TRADABLE_TOKENS.set('bonk', { address: '0x1151cb3d861920e07a38e03eead12c32178567f6', chain: 'evm', specificChain: 'eth', symbol: 'BONK', coingeckoId: 'bonk' });
    TRADABLE_TOKENS.set('pepe', { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', chain: 'evm', specificChain: 'eth', symbol: 'PEPE', coingeckoId: 'pepe' });
}

function initializeTargetAllocations() {
    TARGET_ALLOCATIONS.set('WBTC', 0.30);
    TARGET_ALLOCATIONS.set('WETH', 0.30);
    TARGET_ALLOCATIONS.set('SOL', 0.20);
    TARGET_ALLOCATIONS.set('LINK', 0.10);
    TARGET_ALLOCATIONS.set('BONK', 0.05);
    TARGET_ALLOCATIONS.set('PEPE', 0.05);
}

// --- AI Confidence Function (Copied from rebalancer) ---
async function getRebalanceConfidence(trade: any): Promise<number> {
    const { symbol, type, amountUsd, tokenInfo, currentPrice } = trade;
    const currentAllocation = TARGET_ALLOCATIONS.get(symbol);

    let prompt = `Analyze this proposed portfolio initial setup trade. Provide a confidence score from 0.0 to 1.0. Return ONLY the numeric score, enclosed within <score> tags.\n\n`;
    prompt += `Proposed Action: ${type.toUpperCase()} ${symbol} (Coingecko ID: ${tokenInfo.coingeckoId}) for ${amountUsd.toFixed(2)} USD.\n`;
    prompt += `Current Price: ${currentPrice.toFixed(4)} USD.\n`;
    prompt += `Target Allocation for ${symbol}: ${(currentAllocation! * 100).toFixed(2)}%.\n`;
    prompt += `This trade is for initial portfolio setup.\n\n`;
    prompt += `Consider if this is a good time to execute this initial buy given current market conditions (e.g., extreme volatility, sudden price spikes/drops that might make buying less optimal).`;

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) {
            console.error(`AI API Error for initial setup confidence: ${response.statusText}`);
            return 0;
        }
        const result = await response.json();
        const scoreMatch = result.response.match(/<score>([0-9.]+)<!--\/score-->/);
        if (scoreMatch && scoreMatch[1]) {
            const confidence = parseFloat(scoreMatch[1]);
            console.log(`AI confidence for initial setup ${type} ${symbol}: ${confidence.toFixed(2)}`);
            return confidence;
        }
        console.error(`Failed to parse AI score for initial setup ${type} ${symbol}.`);
        return 0;
    } catch (error) {
        console.error(`Error in getRebalanceConfidence for ${symbol}:`, error);
        return 0;
    }
}

// --- Main Execution ---
async function main() {
  console.log('Starting Initial Portfolio Setup Script...');
  await tradeManager.loadOpenTrades(); // Load existing trades for logging consistency
  initializeTradableTokens();
  initializeTargetAllocations();

  const portfolio = await recall.getPortfolio();
  if (!portfolio) {
    console.error("Could not fetch portfolio. Exiting.");
    return;
  }

  const usdcTokens = portfolio.tokens.filter((t: any) => t.token === USDC_ADDRESS || t.token === USDC_SVM_ADDRESS);
  let availableUSDC = usdcTokens.reduce((sum: number, t: any) => sum + t.amount, 0);

  if (availableUSDC === 0) {
    console.error("No USDC found in portfolio. Cannot perform initial setup. Please deposit USDC.");
    return;
  }

  console.log(`Available USDC for initial setup: ${availableUSDC.toFixed(2)}`);

  const coingeckoIds = Array.from(TRADABLE_TOKENS.values()).map(t => t.coingeckoId);
  const marketData = await coingecko.getMarketData({ vs_currency: 'usd', ids: coingeckoIds.join(',') });

  if (!marketData || marketData.length === 0) {
    console.error("Could not fetch market data for tradable tokens. Exiting.");
    return;
  }

  for (const [symbol, targetPercentage] of TARGET_ALLOCATIONS.entries()) {
    const tokenInfo = Array.from(TRADABLE_TOKENS.values()).find(t => t.symbol === symbol);
    if (!tokenInfo) {
        console.warn(`Token info not found for ${symbol}. Skipping.`);
        continue;
    }

    const currentPriceData = marketData.find((md: any) => md.id === tokenInfo.coingeckoId);
    if (!currentPriceData || !currentPriceData.current_price) {
        console.warn(`Current price not found for ${symbol}. Skipping.`);
        continue;
    }
    const currentPrice = currentPriceData.current_price;

    const amountToBuyUsd = availableUSDC * targetPercentage;

    if (amountToBuyUsd < MIN_TRADE_AMOUNT_USD) {
        console.log(`Skipping initial buy for ${symbol}: Amount (${amountToBuyUsd.toFixed(2)} USD) too small.`);
        continue;
    }

    const tradeDetails = {
        symbol,
        type: 'buy',
        amountUsd: amountToBuyUsd,
        tokenInfo,
        currentPrice,
    };

    // AI Confirmation
    const aiConfidence = await getRebalanceConfidence(tradeDetails);
    if (aiConfidence < AI_CONFIDENCE_THRESHOLD) {
        console.log(`Skipping initial buy for ${symbol}: AI confidence (${aiConfidence.toFixed(2)}) below threshold.`);
        continue;
    }

    console.log(`Attempting to buy ${symbol} for ${amountToBuyUsd.toFixed(2)} USD.`);

    if (TRADE_EXECUTION_ENABLED) {
        try {
            await recall.executeTrade({
                fromToken: tokenInfo.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS,
                toToken: tokenInfo.address,
                amount: amountToBuyUsd.toString(), // Amount in USDC
                reason: `Initial Portfolio Setup: Buy ${symbol}`,
                chain: tokenInfo.chain,
                specificChain: tokenInfo.specificChain,
            });

            // Deduct from available USDC for subsequent buys in this run
            availableUSDC -= amountToBuyUsd;

            await tradeManager.addOpenTrade({
                id: Date.now().toString() + Math.random().toString(36).substring(2, 15),
                fromToken: tokenInfo.chain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS,
                fromTokenSymbol: "USDC",
                fromChain: tokenInfo.chain,
                fromSpecificChain: tokenInfo.specificChain,
                fromAmount: amountToBuyUsd,
                toToken: tokenInfo.address,
                toTokenSymbol: tokenInfo.symbol,
                toChain: tokenInfo.chain,
                toSpecificChain: tokenInfo.specificChain,
                toAmount: (amountToBuyUsd / currentPrice).toString(),
                price: currentPrice,
                tradeAmountUsd: amountToBuyUsd,
                timestamp: new Date().toISOString(),
                competitionId: "N/A",
                agentId: "N/A",
                reason: `Initial Portfolio Setup: Buy ${symbol}`,
            });
            console.log(`SUCCESS: Initial buy executed for ${symbol}. Remaining USDC: ${availableUSDC.toFixed(2)}`);
        } catch (error) {
            console.error(`Error executing initial buy for ${symbol}:`, error);
        }
    } else {
        console.log(`DRY RUN: Initial buy for ${symbol} was identified but not executed. Amount: ${amountToBuyUsd.toFixed(2)} USD.`);
    }
  }

  console.log('Initial Portfolio Setup Script Finished.');
}

main();