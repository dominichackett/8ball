import * as fs from 'fs/promises';
import * as path from 'path';

const OPEN_TRADES_FILE = path.resolve(__dirname, 'open_trades.json');

interface OpenTrade {
    id: string;
    fromToken: string;
    fromTokenSymbol: string;
    fromChain: string;
    fromSpecificChain: string;
    fromAmount: number;
    toToken: string; // address of the token received
    toTokenSymbol: string;
    toChain: string; // type of chain for toToken
    toSpecificChain: string; // specific chain for toToken
    toAmount: string; // amount of toToken received
    price: number; // Entry price (price of toToken in terms of fromToken)
    tradeAmountUsd: number;
    timestamp: string; // ISO 8601 format
    competitionId: string;
    agentId: string;
    reason: string;
    error?: string; // Optional error message if the trade encountered an issue
}

let openTrades: OpenTrade[] = [];

export async function loadOpenTrades(): Promise<void> {
    try {
        const data = await fs.readFile(OPEN_TRADES_FILE, 'utf8');
        openTrades = JSON.parse(data);
        console.log(`Loaded ${openTrades.length} open trades from ${OPEN_TRADES_FILE}`);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`No open trades file found at ${OPEN_TRADES_FILE}. Initializing with empty trades.`);
            openTrades = [];
            await saveOpenTrades(); // Create the file
        } else {
            console.error(`Error loading open trades from ${OPEN_TRADES_FILE}:`, error);
            openTrades = []; // Ensure it's an empty array on error
        }
    }
}

export function getOpenTrades(): OpenTrade[] {
    return openTrades;
}

export async function addOpenTrade(trade: OpenTrade): Promise<void> {
    openTrades.push(trade);
    await saveOpenTrades();
    console.log(`Added new open trade for ${trade.toTokenSymbol}. Total open trades: ${openTrades.length}`);
}

export async function removeOpenTrade(tradeId: string): Promise<void> {
    const initialLength = openTrades.length;
    openTrades = openTrades.filter(trade => trade.id !== tradeId);
    if (openTrades.length < initialLength) {
        await saveOpenTrades();
        console.log(`Removed open trade with ID ${tradeId}. Remaining open trades: ${openTrades.length}`);
    } else {
        console.warn(`Attempted to remove trade with ID ${tradeId}, but it was not found.`);
    }
}

async function saveOpenTrades(): Promise<void> {
    try {
        await fs.writeFile(OPEN_TRADES_FILE, JSON.stringify(openTrades, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error saving open trades to ${OPEN_TRADES_FILE}:`, error);
    }
}
