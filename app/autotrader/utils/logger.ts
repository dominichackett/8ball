import * as fs from 'fs/promises';
import * as path from 'path';

const LOG_FILE = path.resolve(__dirname, '../../../../trades.log'); // Adjust path as needed

export async function logTrade(message: string): Promise<void> {
    try {
        const timestamp = new Date().toISOString();
        await fs.appendFile(LOG_FILE, `[${timestamp}] ${message}\n`, 'utf8');
    } catch (error) {
        console.error('Error writing to trades.log:', error);
    }
}
