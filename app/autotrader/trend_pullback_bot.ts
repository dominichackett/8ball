import 'dotenv/config';
import * as recall from './providers/recall';
import * as coingecko from './providers/coingecko';
import * as tradeManager from './trend_pullback_trade_manager';
import { logTrade } from './utils/logger';

// --- Bot Configuration ---
const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MARKET_TREND_ASSET = 'wrapped-bitcoin'; // Use WBTC to gauge market trend

// --- Global AI Configuration ---
let OVERRIDE_ENABLED = process.env.BOT_OVERRIDE_ENABLED === 'true';
let DEFAULT_AI_CONFIDENCE_THRESHOLD = 0.70; // Use 70% as the default AI confidence threshold
let OVERRIDE_AI_CONFIDENCE_THRESHOLD = parseFloat(process.env.BOT_CONFIDENCE_THRESHOLD || '0.75');
let ATR_THRESHOLD = 1;

// --- Strategy Parameters ---
const strategyParameters = {
    marketTrendSmaShort: 20,
    marketTrendSmaLong: 50,
    entryEmaPeriod: 20,
    // takeProfit: 0.08, // Removed for dollar-based take profit
    // stopLoss: 0.04, // This is already removed
    maxConcurrentPositions: 15,
};

// New: Token-specific dollar take profit values
const tokenTakeProfitDollars = new Map<string, number>();
tokenTakeProfitDollars.set('WETH', 50);
tokenTakeProfitDollars.set('SOL', .3);
tokenTakeProfitDollars.set('LINK', .20);
tokenTakeProfitDollars.set('UNI', 0.20);
tokenTakeProfitDollars.set('POL', 0.02);
tokenTakeProfitDollars.set('WXRP', 0.02);

// --- Token Configuration ---
const TRADABLE_TOKENS = new Map<string, { address: string; chain: 'evm' | 'svm'; specificChain: string; symbol: string }>();
const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_SVM_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
let CLOSE_ALL_POSITIONS = process.env.BOT_CLOSE_ALL_POSITIONS === 'true';

// --- Main Application ---
async function main() {
  console.log('Starting AI-Powered Trend/Pullback Trading Bot...');
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
          const toTokenAddress = trade.fromChain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS;
          await recall.executeTrade({
            fromToken: trade.toToken,
            toToken: toTokenAddress,
            amount: trade.toAmount,
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
  }

  await initializeTradableTokens();

  // Run once immediately on startup
  await runTradingCycle();

  // Then, set up the interval for subsequent runs
  console.log(`Initialization complete. Bot will run every ${POLLING_INTERVAL / 60000} minutes.`);
  setInterval(runTradingCycle, POLLING_INTERVAL);
}

async function initializeTradableTokens() {
    console.log('Initializing tradable tokens...');
    TRADABLE_TOKENS.set('weth', { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', chain: 'evm', specificChain: 'eth', symbol: 'WETH' });
    TRADABLE_TOKENS.set('chainlink', { address: '0x514910771af9ca656af840dff83e8264ecf986ca', chain: 'evm', specificChain: 'eth', symbol: 'LINK' });
    TRADABLE_TOKENS.set('solana', { address: 'So11111111111111111111111111111111111111112', chain: 'svm', specificChain: 'svm', symbol: 'SOL' });
    TRADABLE_TOKENS.set('wrapped-xrp', { address: '0x39fbbabf11738317a448031930706cd3e612e1b9', chain: 'evm', specificChain: 'eth', symbol: 'WXRP' });
    TRADABLE_TOKENS.set('uniswap', { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', chain: 'evm', specificChain: 'eth', symbol: 'UNI' });
    TRADABLE_TOKENS.set('polygon-ecosystem-token', { address: '0x455e53cbb86018ac2b8092fdcd39d8444affc3f6', chain: 'evm', specificChain: 'eth', symbol: 'POL' });

    console.log(`Initialization complete. ${TRADABLE_TOKENS.size} tokens are tradable.`);
}

// --- Core Bot Logic ---
async function runTradingCycle() {
  console.log('\n--- Running AI Trend/Pullback Trading Cycle ---');
  try {
    const marketTrend = await getOverallMarketTrend();
    console.log(`Current Market Trend: ${marketTrend}`);

    const [marketData, agentBalances] = await Promise.all([
        coingecko.getMarketData({ vs_currency: 'usd', ids: Array.from(TRADABLE_TOKENS.keys()).join(',') }),
        recall.getAgentBalances()
    ]);

    if (!marketData || marketData.length === 0) return;

    let tradeableEvmUsdcBalances = new Map<string, { amount: number, address: string }>();
    let svmUsdcBalance = 0;
    if (agentBalances) {
        agentBalances.balances.forEach((balance: any) => {
            if ((balance.symbol === 'USDC' || balance.symbol ==='USDbC' )) {
                if (balance.chain === 'evm') {
                    tradeableEvmUsdcBalances.set(balance.specificChain, { amount: (tradeableEvmUsdcBalances.get(balance.specificChain)?.amount || 0) + balance.amount, address: balance.tokenAddress });
                } else if (balance.chain === 'svm') {
                    svmUsdcBalance += balance.amount;
                }
            }
        });
    }

    // --- New Logging Logic ---
    console.log("--- Available Capital ---");
    tradeableEvmUsdcBalances.forEach((data, chain) => {
        console.log(`  - ${chain.toUpperCase()}: ${data.amount.toFixed(2)} USDC`);
    });
    if (svmUsdcBalance > 0) {
        console.log(`  - SVM: ${svmUsdcBalance.toFixed(2)} USDC`);
    }
    const totalEvmBalance = Array.from(tradeableEvmUsdcBalances.values()).reduce((sum, balance) => sum + balance.amount, 0);
    const grandTotalBalance = totalEvmBalance + svmUsdcBalance;
    console.log(`  - TOTAL: ${grandTotalBalance.toFixed(2)} USDC`);
    console.log("-------------------------");
    // --- End New Logging Logic ---

    await monitorOpenPositions(marketData);

    if (marketTrend === 'UPTREND') {
      if (tradeManager.getOpenTrades().length >= strategyParameters.maxConcurrentPositions) return;
      
      const analyzedOpportunities = await findPullbackOpportunities(marketData, marketTrend);
      
      let finalOpportunities;
      if (OVERRIDE_ENABLED) {
          finalOpportunities = analyzedOpportunities.filter(t => t.aiConfidence && t.aiConfidence >= OVERRIDE_AI_CONFIDENCE_THRESHOLD);
      } else {
          finalOpportunities = analyzedOpportunities.filter(t => t.isOpportunity && t.aiConfidence && t.aiConfidence >= DEFAULT_AI_CONFIDENCE_THRESHOLD);
      }

      await executeTrades(finalOpportunities, tradeableEvmUsdcBalances, svmUsdcBalance);
    } else {
      console.log('Market is not in an uptrend. Not looking for new buy opportunities.');
    }

  } catch (error) {
    console.error('Error in trading cycle:', error);
  }
}

async function getOverallMarketTrend(): Promise<'UPTREND' | 'DOWNTREND' | 'SIDEWAYS'> {
    try {
        const chartData = await coingecko.getMarketChart(MARKET_TREND_ASSET, { vs_currency: 'usd', days: '14' });
        if (!chartData || !chartData.prices || chartData.prices.length < strategyParameters.marketTrendSmaLong) return 'SIDEWAYS';

        const prices = chartData.prices.map((p: number[]) => p[1]);
        const smaShort = calculateSMA(prices, strategyParameters.marketTrendSmaShort);
        const smaLong = calculateSMA(prices, strategyParameters.marketTrendSmaLong);

        return smaShort[smaShort.length - 1] > smaLong[smaLong.length - 1] ? 'UPTREND' : 'DOWNTREND';
    } catch (error) {
        console.error('Error determining market trend:', error);
        return 'SIDEWAYS';
    }
}

async function findPullbackOpportunities(marketData: any[], marketTrend: string): Promise<any[]> {
    let opportunities = [];
    for (const coin of marketData) {
        if (!TRADABLE_TOKENS.has(coin.id)) continue;

        // Fetch OHLC data for ATR calculation
        const ohlcData = await coingecko.getOHLC(coin.id, { vs_currency: 'usd', days: 14 }); // Using 14 days for ATR
        if (!ohlcData || ohlcData.length === 0) {
            console.log(`No OHLC data for ${coin.id}. Skipping ATR calculation.`);
            continue;
        }

        const atr = calculateATR(ohlcData, 14); // Calculate ATR with 14-period
        if (atr === 0) {
            console.log(`ATR is zero for ${coin.id}. Skipping.`);
            continue;
        }

        // Define the threshold for 'isNearEma' using ATR
        const atrThreshold = atr * ATR_THRESHOLD; // Using 0.5 times ATR for the threshold.

        const chartData = await coingecko.getMarketChart(coin.id, { vs_currency: 'usd', days: '7' });
        if (!chartData || !chartData.prices || chartData.prices.length < strategyParameters.entryEmaPeriod) continue;

        const prices = chartData.prices.map((p: number[]) => p[1]);
        const ema = calculateEMA(prices, strategyParameters.entryEmaPeriod);
        const lastEma = ema[ema.length - 1];

        const tokenInfo = TRADABLE_TOKENS.get(coin.id);
        if (!tokenInfo) {
            console.log(`Token info not found for ${coin.id}. Skipping.`);
            continue;
        }

        const recallPriceResult = await recall.getPrice({ token: tokenInfo.address, chain: tokenInfo.chain, specificChain: tokenInfo.specificChain });
        if (!recallPriceResult || !recallPriceResult.price) {
            console.log(`Could not get current price for ${coin.symbol} from Recall. Skipping.`);
            continue;
        }
        const currentPrice = recallPriceResult.price;

        // Use ATR-based threshold for isNearEma
        const isNearEma = Math.abs(currentPrice - lastEma) <= atrThreshold; // Changed to absolute difference and ATR threshold

        const isOpportunity = currentPrice > lastEma && isNearEma;


        // Get CoinGecko price for logging
        const coingeckoCurrentPrice = coin.current_price;

        console.log(`--- ${coin.symbol.toUpperCase()} Analysis ---`);
        console.log(`  Current Price (Recall): ${currentPrice.toFixed(4)}`);
        console.log(`  Current Price (CoinGecko): ${coingeckoCurrentPrice.toFixed(4)}`); // New line
        console.log(`  Last EMA (${strategyParameters.entryEmaPeriod}-period): ${lastEma.toFixed(4)}`);
        console.log(`  ATR: ${atr.toFixed(4)}`);
        console.log(`  ATR Threshold (${ATR_THRESHOLD} * ATR): ${atrThreshold.toFixed(4)}`);
        console.log(`  Is Near EMA: ${isNearEma}`);
        console.log(`  Is Opportunity (Price > EMA && Is Near EMA): ${isOpportunity}`);
        console.log(`--------------------------`);

        if (isOpportunity) {
            const tokenInfo = TRADABLE_TOKENS.get(coin.id);
            const opportunityDetails = { ...coin, ...tokenInfo, isOpportunity, lastEma };
            const { confidence, reason } = await getTradeConfidence(opportunityDetails, marketTrend);
            opportunities.push({ ...opportunityDetails, aiConfidence: confidence, aiReason: reason });
        }
    }
    return opportunities;}

async function getTradeConfidence(opportunity: any, marketTrend: string): Promise<{ confidence: number; reason: string }> {
    const prompt = `
    Analyze the following trade opportunity and provide a confidence score from 0.0 to 1.0 for a BUY trade.
    A score of 1.0 represents maximum confidence. Return ONLY the numeric score, enclosed within <score> tags (e.g., <score>0.85</score>).
    You may also provide additional explanatory text outside these tags.

    Strategy Context:
    - The overall market trend is currently determined to be: ${marketTrend}.
    - The trading strategy is to buy tokens that are in a temporary pullback to a key support level within this broader market trend.

    Token Details:
    - Symbol: ${opportunity.symbol.toUpperCase()}
    - Current Price: ${opportunity.current_price.toFixed(4)}
    - Key Support Level (20-period EMA): ${opportunity.lastEma.toFixed(4)}
    - Signal: The current price is near this Exponential Moving Average, suggesting a potential bounce.

    Based on this information, what is your confidence in this trade?`;

    try {
        const response = await fetch('http://localhost:3000/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userMessage: prompt }),
        });
        if (!response.ok) {
            console.error(`Error fetching trade confidence for ${opportunity.symbol.toUpperCase()}: ${response.statusText}`);
            return { confidence: 0, reason: "Error fetching confidence." };
        }
        const result = await response.json();
        const aiResponse = result.response;
        
        // --- DEBUGGING LINE ---
        console.log("AI Raw Response for", opportunity.symbol, ":", aiResponse);
        // --- END DEBUGGING LINE ---

    let scoreMatch = aiResponse.match(/<score>([0-9.]+)<\/score>/);        
    let confidence = 0;

        if (scoreMatch && scoreMatch[1]) {
            confidence = parseFloat(scoreMatch[1]);
        } else {
            scoreMatch = aiResponse.match(/confidence score of \*\*([0-9.]+)\*\*/);
            if (scoreMatch && scoreMatch[1]) {
                confidence = parseFloat(scoreMatch[1]);
            }
        }

        const reason = aiResponse.replace(/<score>([0-9.]+)<\/score>/, '').trim(); // Corrected regex
        console.log(`AI confidence for ${opportunity.symbol.toUpperCase()}: ${confidence.toFixed(2)} (Bot Opportunity: ${opportunity.isOpportunity})`);
        return { confidence, reason };

    } catch (error) {
        console.error(`Error in getTradeConfidence for ${opportunity.symbol.toUpperCase()}:`, error);
        return { confidence: 0, reason: "Exception caught during confidence check." };
    }
}

async function executeTrades(opportunities: any[], tradeableEvmUsdcBalances: Map<string, { amount: number, address: string }>, svmUsdcBalance: number) {
    if (opportunities.length === 0) return;

    for (const opportunity of opportunities) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of today

        if (tradeManager.getOpenTrades().some(t => {
            if (t.toTokenSymbol === opportunity.symbol) {
                const tradeDate = new Date(t.timestamp);
                tradeDate.setHours(0, 0, 0, 0); // Set to start of trade's day
                return tradeDate.getTime() === today.getTime();
            }
            return false;
        })) {
            console.log(`Skipping trade for ${opportunity.symbol.toUpperCase()}: Already have an open trade for this token opened today.`);
            continue;
        }

        let currentPositionSizeInUsdc; // This will be the USDC amount to spend
        let tokenAmountToBuy; // This will be the amount of the token to receive

        if (opportunity.symbol.toUpperCase() === 'WETH') {
            // Get WETH price in USDC using recall.getPrice
            const wethPriceResult = await recall.getPrice({ token: TRADABLE_TOKENS.get('weth')?.address, chain: 'evm', specificChain: 'eth' });
            if (!wethPriceResult || !wethPriceResult.price) {
                console.log(`Could not get current price for WETH using recall. Skipping trade.`);
                continue;
            }
            const wethPriceInUsdc = wethPriceResult.price;
            currentPositionSizeInUsdc = wethPriceInUsdc; // Cost to buy 1 WETH
            tokenAmountToBuy = 1; // We want to buy 1 WETH
        } else {
            currentPositionSizeInUsdc = 1000; // Spend 1000 USDC for other tokens
            tokenAmountToBuy = 0; // This will be determined by the recall.executeTrade result
        }

        let fromTokenAddress, fromChain, fromSpecificChain;

        if (opportunity.chain === 'svm') {
            if (svmUsdcBalance >= currentPositionSizeInUsdc) { // Check against USDC equivalent
                fromTokenAddress = USDC_SVM_ADDRESS;
                fromChain = 'svm';
                fromSpecificChain = 'svm';
            }
        } else {
            const preferredEvmChains = [opportunity.specificChain, 'base', 'polygon', 'arbitrum', 'optimism', 'eth'];
            for (const chain of preferredEvmChains) {
                const evmBalanceInfo = tradeableEvmUsdcBalances.get(chain);
                if (evmBalanceInfo && evmBalanceInfo.amount >= currentPositionSizeInUsdc) { // Check against USDC equivalent
                    fromTokenAddress = evmBalanceInfo.address;
                    fromChain = 'evm';
                    fromSpecificChain = chain;
                    break;
                }
            }
        }

        if (!fromTokenAddress) {
            console.log(`Insufficient USDC balance for ${opportunity.symbol.toUpperCase()}.`);
            continue;
        }

        const reason = opportunity.aiReason ? `AI Reason: ${opportunity.aiReason}` : `AI-driven trend/pullback trade. Confidence: ${(opportunity.aiConfidence * 100).toFixed(0)}%.`;
        console.log(`Executing BUY for ${opportunity.symbol.toUpperCase()} from ${fromSpecificChain.toUpperCase()} with ${currentPositionSizeInUsdc.toFixed(2)} USDC.`); // Log USDC amount

        try {
            const tradeResult = await recall.executeTrade({
                fromToken: fromTokenAddress,
                toToken: opportunity.address,
                amount: currentPositionSizeInUsdc.toString(), // Amount of USDC to spend
                reason,
                chain: fromChain,
                specificChain: fromSpecificChain
            });

            // For WETH, we explicitly wanted to buy 1 token, so use that.
            // For others, use the amount returned by the tradeResult.
            const finalTokenAmountToBuy =  tradeResult.transaction.toAmount;

            await tradeManager.addOpenTrade({
                id: tradeResult.transaction.id,
                fromToken: fromTokenAddress,
                fromTokenSymbol: "USDC",
                fromChain,
                fromSpecificChain,
                fromAmount: currentPositionSizeInUsdc, // Amount of USDC spent
                toToken: opportunity.address,
                toTokenSymbol: opportunity.symbol,
                toChain: opportunity.chain,
                toSpecificChain: opportunity.specificChain,
                toAmount: finalTokenAmountToBuy, // Amount of token received
                price: opportunity.current_price,
                tradeAmountUsd: currentPositionSizeInUsdc, // Amount of USDC spent
                timestamp: new Date().toISOString(),
                competitionId: "N/A",
                agentId: "N/A",
                reason
            });
            console.log(`Successfully opened position for ${opportunity.symbol}.`);
            await logTrade(`OPENED: ${opportunity.symbol.toUpperCase()} - Amount: ${finalTokenAmountToBuy} - Price: ${opportunity.current_price} - Reason: ${reason}`);
        } catch (error) {
            console.error(`Error executing trade for ${opportunity.symbol}:`, error);
        }
    }
}

async function monitorOpenPositions(marketData: any[]) {
    const openTrades = tradeManager.getOpenTrades();
    if (openTrades.length === 0) return;

    for (const trade of openTrades) {
        let tokenInfo = null;
        for (const [key, value] of TRADABLE_TOKENS.entries()) {
            if (value.symbol.toLowerCase() === trade.toTokenSymbol.toLowerCase()) {
                tokenInfo = value;
                break;
            }
        }
        if (!tokenInfo) {
            console.log(`Token info not found for ${trade.toTokenSymbol}. Skipping monitoring.`);
            continue;
        }

        const recallPriceResult = await recall.getPrice({ token: tokenInfo.address, chain: tokenInfo.chain, specificChain: tokenInfo.specificChain });
        if (!recallPriceResult || !recallPriceResult.price) {
            console.log(`Could not get current price for ${trade.toTokenSymbol} from Recall. Skipping monitoring.`);
            continue;
        }
        const currentPrice = recallPriceResult.price; // Use price from Recall

        const dollarPnl = currentPrice - trade.price; // Use Recall price for PnL
        const requiredTakeProfit = tokenTakeProfitDollars.get(trade.toTokenSymbol.toUpperCase());

        if (requiredTakeProfit !== undefined && dollarPnl >= requiredTakeProfit) {
            const reason = 'Take-profit';
            console.log(`Exit condition met for ${trade.toTokenSymbol}: ${reason}.`);
            const toTokenAddress = trade.fromChain === 'svm' ? USDC_SVM_ADDRESS : USDC_ADDRESS;
            try {
                await recall.executeTrade({ fromToken: trade.toToken, toToken: toTokenAddress, amount: trade.toAmount, reason, chain: trade.toChain, specificChain: trade.toSpecificChain });
                await tradeManager.removeOpenTrade(trade.id);
                console.log(`Closed position for ${trade.toTokenSymbol}.`);
                await logTrade(`CLOSED: ${trade.toTokenSymbol.toUpperCase()} - Open Price: ${trade.price.toFixed(4)} - Close Price: ${currentPrice.toFixed(4)} - Profit Per Token: ${dollarPnl.toFixed(2)} - Total Profit: ${(dollarPnl * trade.toAmount).toFixed(2)} - Reason: ${reason}`);
            } catch (error) {
                console.error(`Error closing position for ${trade.toTokenSymbol}:`, error);
            }
        }
    }
}

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

function calculateATR(ohlcData: number[][], period: number = 14): number {
    if (ohlcData.length < period) return 0;

    let trueRanges: number[] = [];
    for (let i = 1; i < ohlcData.length; i++) {
        const high = ohlcData[i][2];
        const low = ohlcData[i][3];
        const prevClose = ohlcData[i - 1][4];

        const tr1 = high - low;
        const tr2 = Math.abs(high - prevClose);
        const tr3 = Math.abs(low - prevClose);

        trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    // Calculate initial ATR (SMA of first 'period' true ranges)
    let atr = trueRanges.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;

    // Calculate subsequent ATR values using Wilder's smoothing method
    for (let i = period; i < trueRanges.length; i++) {
        atr = (atr * (period - 1) + trueRanges[i]) / period;
    }

    return atr;
}

main();
