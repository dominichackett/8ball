
import * as fs from 'fs/promises';
import { Trade } from '../../types/api';

const TRADES_FILE = './app/autotrader/solana_memecoin_bot/solana_memecoin_trades.json';
let openTrades: Trade[] = [];

export async function loadOpenTrades() {
    try {
        const data = await fs.readFile(TRADES_FILE, 'utf-8');
        openTrades = JSON.parse(data);
        console.log('Loaded open trades for Solana Memecoin Bot.');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('No open trades file found for Solana Memecoin Bot, starting fresh.');
            openTrades = [];
        } else {
            console.error('Error loading open trades for Solana Memecoin Bot:', error);
        }
    }
}

export function getOpenTrades(): Trade[] {
    return openTrades;
}

export async function addOpenTrade(trade: Trade) {
    openTrades.push(trade);
    await saveOpenTrades();
}

export async function removeOpenTrade(tradeId: string) {
    openTrades = openTrades.filter(t => t.id !== tradeId);
    await saveOpenTrades();
}

async function saveOpenTrades() {
    try {
        await fs.writeFile(TRADES_FILE, JSON.stringify(openTrades, null, 2));
    } catch (error) {
        console.error('Error saving open trades for Solana Memecoin Bot:', error);
    }
}
