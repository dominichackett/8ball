
import fetch from 'node-fetch';

const API_BASE_URL = 'https://api.dexscreener.com/latest/dex';

// Interface for the API response
interface DexScreenerApiPair {
    chainId: string;
    dexId: string;
    url: string;
    pairAddress: string;
    baseToken: {
        address: string;
        name: string;
        symbol: string;
    };
    priceUsd?: string;
    liquidity?: {
        usd?: number;
    };
    pairCreatedAt: number;
}

// Interface for our application
export interface DexScreenerPair {
    symbol: string;
    tokenAddress: string;
    priceUsd: number;
    liquidity: number;
    chain: 'evm' | 'svm';
    specificChain: string;
}

interface GetTopTrendingPairsParams {
    minLiquidity: number;
}

function getChainDetails(chainId: string): { chain: 'evm' | 'svm', specificChain: string } | null {
    const mapping: { [key: string]: { chain: 'evm' | 'svm', specificChain: string } } = {
        'solana': { chain: 'svm', specificChain: 'svm' },
        'ethereum': { chain: 'evm', specificChain: 'eth' },
        'bsc': { chain: 'evm', specificChain: 'bsc' },
        'polygon': { chain: 'evm', specificChain: 'polygon' },
        'arbitrum': { chain: 'evm', specificChain: 'arbitrum' },
        'optimism': { chain: 'evm', specificChain: 'optimism' },
        'base': { chain: 'evm', specificChain: 'base' },
    };
    return mapping[chainId] || null;
}

/**
 * Fetches new pairs from DEX Screener by searching for pairs with recent creation dates and high volume.
 * This is a proxy for "trending" since the API doesn't have a direct trending endpoint.
 * @see https://docs.dexscreener.com/api/reference
 */
export async function getTopTrendingPairs(params: GetTopTrendingPairsParams): Promise<DexScreenerPair[]> {
    console.log('Fetching top trending pairs from DEX Screener...');
    
    try {
        // Search for pairs with high volume in the last 24 hours
        const query = 'usd > 100000 AND age < 24h';
        const response = await fetch(`${API_BASE_URL}/search?q=${query}`);
        
        if (!response.ok) {
            throw new Error(`DEX Screener API request failed with status: ${response.status}`);
        }

        const data = await response.json() as { pairs: DexScreenerApiPair[] };

        if (!data.pairs) {
            console.log('No pairs found in DEX Screener response.');
            return [];
        }

        const mappedPairs = data.pairs
            .map(pair => {
                const priceUsd = parseFloat(pair.priceUsd || '0');
                const liquidity = pair.liquidity?.usd || 0;
                const chainDetails = getChainDetails(pair.chainId);

                if (!chainDetails || !priceUsd || liquidity < params.minLiquidity) {
                    return null;
                }

                return {
                    symbol: pair.baseToken.symbol,
                    tokenAddress: pair.baseToken.address,
                    priceUsd,
                    liquidity,
                    chain: chainDetails.chain,
                    specificChain: chainDetails.specificChain,
                };
            })
            .filter((p): p is DexScreenerPair => p !== null);

        console.log(`Found and mapped ${mappedPairs.length} pairs from DEX Screener.`);
        return mappedPairs;

    } catch (error) {
        console.error('Error fetching from DEX Screener API:', error);
        return []; // Return an empty array on error
    }
}

export async function getNewPairs(chain: string): Promise<DexScreenerApiPair[]> {
    try {
        const response = await fetch(`${API_BASE_URL}/pairs/${chain}/new`);
        if (!response.ok) {
            throw new Error(`DEX Screener API request failed with status: ${response.status}`);
        }
        const data = await response.json() as { pairs: DexScreenerApiPair[] };
        if (!data.pairs) {
            return [];
        }
        return data.pairs;
    } catch (error) {
        console.error(`Error fetching new pairs for ${chain}:`, error);
        return [];
    }
}

export async function getPairPrice(tokenAddress: string): Promise<{ priceUsd: string } | null> {
    try {
        const response = await fetch(`${API_BASE_URL}/search?q=${tokenAddress}`);
        if (!response.ok) {
            throw new Error(`DEX Screener API request failed with status: ${response.status}`);
        }
        const data = await response.json() as { pairs: DexScreenerApiPair[] };

        if (!data.pairs || data.pairs.length === 0) {
            console.log(`No pairs found for token ${tokenAddress}.`);
            return null;
        }

        // Find the most liquid pair
        const mostLiquidPair = data.pairs.reduce((prev, current) => {
            return (prev.liquidity?.usd || 0) > (current.liquidity?.usd || 0) ? prev : current;
        });

        if (mostLiquidPair && mostLiquidPair.priceUsd) {
            return { priceUsd: mostLiquidPair.priceUsd };
        }

        return null;
    } catch (error) {
        console.error(`Error fetching price for token ${tokenAddress}:`, error);
        return null;
    }
}
