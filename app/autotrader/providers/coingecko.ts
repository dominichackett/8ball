import 'dotenv/config';
const COINGECKO_API_BASE_URL = "https://api.coingecko.com/api/v3";

async function coingeckoApiRequest(endpoint: string, params: any = {}) {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers: any = {};
    if (apiKey) {
        headers['x-cg-demo-api-key'] = apiKey;
    }

    const queryParams = new URLSearchParams(params).toString();
    const url = `${COINGECKO_API_BASE_URL}${endpoint}${queryParams ? `?${queryParams}` : ''}`;

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch from ${endpoint}: ${response.status} ${errorText}`);
        }
        return await response.json();
    } catch (error: any) {
        console.error(`Error calling CoinGecko API endpoint ${endpoint}:`, error.message);
        throw error;
    }
}

export const getMarketData = (params: { vs_currency: string, per_page?: number, ids?: string }) => 
    coingeckoApiRequest('/coins/markets', params);

export const getMarketChart = (id: string, params: { vs_currency: string, days: string }) =>
    coingeckoApiRequest(`/coins/${id}/market_chart`, params);

export const getCoinDetails = (id: string) =>
    coingeckoApiRequest(`/coins/${id}`);

export const getOHLC = (id: string, params: { vs_currency: string, days: string }) =>
    coingeckoApiRequest(`/coins/${id}/ohlc`, params);