const RECALL_API_URL = process.env.RECALL_URL || 'https://api.sandbox.competitions.recall.network';
const RECALL_API_KEY = process.env.RECALL_API_KEY;

async function recallApiRequest(endpoint: string, method: 'GET' | 'POST' = 'GET', body: any = null) {
    if (!RECALL_API_KEY) throw new Error("RECALL_API_KEY is not set.");

    const headers: HeadersInit = {
        'Authorization': `Bearer ${RECALL_API_KEY}`,
        'Content-Type': 'application/json'
    };

    const config: RequestInit = {
        method,
        headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${RECALL_API_URL}${endpoint}`, config);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch from ${endpoint}: ${response.status} ${errorText}`);
        }
        return await response.json();
    } catch (error: any) {
        console.error(`Error calling Recall API endpoint ${endpoint}:`, error.message);
        throw error;
    }
}

export const getPortfolio = () => recallApiRequest('/agent/portfolio');
export const getAgentTrades = () => recallApiRequest('/agent/trades');
export const getPrice = (params: { token: string, chain: string, specificChain: string }) => 
    recallApiRequest(`/price?token=${params.token}&chain=${params.chain}&specificChain=${params.specificChain}`);

export const executeTrade = (tradeDetails: { fromToken: string, toToken: string, amount: string, reason: string }) => 
    recallApiRequest('/trade/execute', 'POST', tradeDetails);

export const getAgentBalances = () => recallApiRequest('/agent/balances');