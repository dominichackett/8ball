
import * as fs from 'fs/promises';
import * as path from 'path';

const TRADES_FILE = path.join(__dirname, 'memecoin_trades.json');

interface Trade {
    id: string;
    toTokenSymbol: string;
    toTokenAddress: string;
    amount: string;
    price: number;
    timestamp: string;
    chain: 'evm' | 'svm';
    specificChain: string;
}

let openTrades: Trade[] = [];

export async function loadOpenTrades(): Promise<void> {
    try {
        const data = await fs.readFile(TRADES_FILE, 'utf-8');
        openTrades = JSON.parse(data);
        console.log(`Loaded ${openTrades.length} open meme coin trades.`);
    } catch (error) {
        // If the file doesn't exist, it's fine.
        if (error.code === 'ENOENT') {
            console.log('No open meme coin trades file found. Starting fresh.');
            openTrades = [];
        } else {
            console.error('Error loading open trades:', error);
        }
    }
}

async function saveOpenTrades(): Promise<void> {
    await fs.writeFile(TRADES_FILE, JSON.stringify(openTrades, null, 2));
}

export function getOpenTrades(): Trade[] {
    return [...openTrades];
}

export function hasOpenTrade(tokenAddress: string): boolean {
    return openTrades.some(trade => trade.toTokenAddress.toLowerCase() === tokenAddress.toLowerCase());
}

export async function addOpenTrade(trade: Trade): Promise<void> {
    openTrades.push(trade);
    await saveOpenTrades();
}

export async function removeOpenTrade(tradeId: string): Promise<void> {
    openTrades = openTrades.filter(t => t.id !== tradeId);
    await saveOpenTrades();
}
