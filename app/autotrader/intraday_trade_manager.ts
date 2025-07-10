import * as fs from 'fs/promises';
import * as path from 'path';

// Point to a new file to keep intraday trades separate
const OPEN_TRADES_FILE = path.resolve(__dirname, 'intraday_open_trades.json');

interface OpenTrade {
    id: string;
    fromToken: string;
    fromTokenSymbol: string;
    fromChain: string;
    fromSpecificChain: string;
    fromAmount: number;
    toToken: string; 
    toTokenSymbol: string;
    toChain: string; 
    toSpecificChain: string;
    toAmount: string; 
    price: number; // Entry price
    tradeAmountUsd: number;
    timestamp: string; 
    competitionId: string;
    agentId: string;
    reason: string;
    error?: string;
    highWaterMark?: number; // Add highWaterMark for trailing stop
}

let openTrades: OpenTrade[] = [];

export async function loadOpenTrades(): Promise<void> {
    try {
        const data = await fs.readFile(OPEN_TRADES_FILE, 'utf8');
        openTrades = JSON.parse(data);
        console.log(`Loaded ${openTrades.length} open intraday trades from ${OPEN_TRADES_FILE}`);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`No open trades file found at ${OPEN_TRADES_FILE}. Initializing with empty trades.`);
            openTrades = [];
            await saveOpenTrades();
        } else {
            console.error(`Error loading open trades from ${OPEN_TRADES_FILE}:`, error);
            openTrades = [];
        }
    }
}

export function getOpenTrades(): OpenTrade[] {
    return openTrades;
}

export async function addOpenTrade(trade: OpenTrade): Promise<void> {
    openTrades.push(trade);
    await saveOpenTrades();
    console.log(`Added new open intraday trade for ${trade.toTokenSymbol}. Total: ${openTrades.length}`);
}

export async function removeOpenTrade(tradeId: string): Promise<void> {
    const initialLength = openTrades.length;
    openTrades = openTrades.filter(trade => trade.id !== tradeId);
    if (openTrades.length < initialLength) {
        await saveOpenTrades();
        console.log(`Removed open intraday trade with ID ${tradeId}. Remaining: ${openTrades.length}`);
    } else {
        console.warn(`Attempted to remove intraday trade with ID ${tradeId}, but it was not found.`);
    }
}

// New function to update a trade, e.g., for the highWaterMark
export async function updateOpenTrade(tradeId: string, updates: Partial<OpenTrade>): Promise<void> {
    const tradeIndex = openTrades.findIndex(trade => trade.id === tradeId);
    if (tradeIndex !== -1) {
        openTrades[tradeIndex] = { ...openTrades[tradeIndex], ...updates };
        await saveOpenTrades();
    } else {
        console.warn(`Attempted to update trade with ID ${tradeId}, but it was not found.`);
    }
}

async function saveOpenTrades(): Promise<void> {
    try {
        await fs.writeFile(OPEN_TRADES_FILE, JSON.stringify(openTrades, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error saving open intraday trades to ${OPEN_TRADES_FILE}:`, error);
    }
}
