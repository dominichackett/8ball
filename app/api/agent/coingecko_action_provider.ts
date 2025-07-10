import { ActionProvider, CreateAction, Network, WalletProvider } from "@coinbase/agentkit";
import { z } from "zod";
import axios from "axios";
import 'dotenv/config';

const coingeckoApi = axios.create({
    baseURL: "https://api.coingecko.com/api/v3",
    headers: process.env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': process.env.COINGECKO_API_KEY } : {},
});


export class CoinGeckoActionProvider extends ActionProvider<WalletProvider> {
  constructor() {
    super("coingecko", []);
  }

  @CreateAction({
    name: "getCurrentPrices",
    description: "Fetches real-time prices for given coin IDs with 24h changes.",
    schema: z.object({
      coinIds: z.array(z.string()).describe("Comma-separated list of coin IDs (e.g., 'bitcoin,ethereum')"),
      vsCurrency: z.string().describe("The currency to compare against (e.g., 'usd', 'eth')"),
      includeChanges: z.boolean().optional().describe("Include 24h price change percentage"),
    }),
  })
  async getCurrentPrices(input: z.infer<typeof this.getCurrentPrices.schema>): Promise<any> {
    try {
      const { coinIds, vsCurrency, includeChanges } = input;
      const params: any = {
        ids: coinIds.join(","),
        vs_currencies: vsCurrency,
      };
      if (includeChanges) {
        params.include_24hr_change = "true";
      }

      const response = await coingeckoApi.get(`/simple/price`, {
        params,
        timeout: 5000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching current prices:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getMarketData",
    description: "Fetches market overview with rankings.",
    schema: z.object({
      vsCurrency: z.string().describe("The currency to compare against (e.g., 'usd')"),
      order: z.string().optional().describe("Order results by (e.g., 'market_cap_desc')"),
      perPage: z.number().optional().describe("Number of results per page"),
      priceChangePercentage: z.string().optional().describe("Include price change percentage for 1h, 24h, 7d, 14d, 30d, 200d, 1y (e.g., '24h,7d')"),
    }),
  })
  async getMarketData(input: z.infer<typeof this.getMarketData.schema>): Promise<any> {
    try {
      const { vsCurrency, order, perPage, priceChangePercentage } = input;
      const params: any = {
        vs_currency: vsCurrency,
      };
      if (order) params.order = order;
      if (perPage) params.per_page = perPage;
      if (priceChangePercentage) params.price_change_percentage = priceChangePercentage;

      const response = await coingeckoApi.get(`/coins/markets`, {
        params,
        timeout: 5000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching market data:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getHistoricalChart",
    description: "Fetches OHLCV data for technical indicators.",
    schema: z.object({
      coinId: z.string().describe("The coin ID (e.g., 'bitcoin')"),
      vsCurrency: z.string().describe("The currency to compare against (e.g., 'usd')"),
      days: z.union([z.number(), z.literal("max")]).describe("Data for the last N days or 'max'"),
      interval: z.string().optional().describe("Data interval (e.g., 'daily', 'hourly')"),
    }),
  })
  async getHistoricalChart(input: z.infer<typeof this.getHistoricalChart.schema>): Promise<any> {
    try {
      const { coinId, vsCurrency, days, interval } = input;
      const params: any = {
        vs_currency: vsCurrency,
        days: days.toString(),
      };
      if (interval) params.interval = interval;

      const response = await coingeckoApi.get(`/coins/${coinId}/market_chart`, {
        params,
        timeout: 10000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching historical chart data:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getTrendingTokens",
    description: "Fetches hot/trending cryptocurrencies.",
    schema: z.object({}),
  })
  async getTrendingTokens(): Promise<any> {
    try {
      const response = await coingeckoApi.get(`/search/trending`, {
        timeout: 5000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching trending tokens:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getTopGainersLosers",
    description: "Fetches biggest price movers.",
    schema: z.object({
      vsCurrency: z.string().describe("The currency to compare against (e.g., 'usd')"),
      duration: z.enum(["1h", "24h", "7d", "30d"]).describe("Duration for gainers/losers"),
    }),
  })
  async getTopGainersLosers(input: z.infer<typeof this.getTopGainersLosers.schema>): Promise<any> {
    try {
      const { vsCurrency, duration } = input;
      const response = await coingeckoApi.get(`/coins/markets`, {
        params: {
          vs_currency: vsCurrency,
          price_change_percentage: duration,
          order: "market_cap_desc",
          per_page: 250,
        },
        timeout: 5000,
      });

      const coins = response.data;
      const priceChangeField = `price_change_percentage_${duration}_in_currency`;
      
      const gainers = coins
        .filter((coin: any) => coin[priceChangeField] != null && coin[priceChangeField] > 0)
        .sort((a: any, b: any) => b[priceChangeField] - a[priceChangeField]);
        
      const losers = coins
        .filter((coin: any) => coin[priceChangeField] != null && coin[priceChangeField] < 0)
        .sort((a: any, b: any) => a[priceChangeField] - b[priceChangeField]);

      return { success: true, data: { gainers: gainers.slice(0, 10), losers: losers.slice(0, 10) } };
    } catch (error: any) {
      console.error("Error fetching top gainers/losers:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getGlobalMarketData",
    description: "Fetches global market cap, BTC dominance, and other global metrics.",
    schema: z.object({}),
  })
  async getGlobalMarketData(): Promise<any> {
    try {
      const response = await coingeckoApi.get(`/global`, {
        timeout: 5000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching global market data:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getDEXPools",
    description: "Fetches on-chain DEX liquidity data.",
    schema: z.object({
      network: z.string().describe("The blockchain network (e.g., 'ethereum', 'solana')"),
      tokenAddress: z.string().describe("The token contract address"),
    }),
  })
  async getDEXPools(input: z.infer<typeof this.getDEXPools.schema>): Promise<any> {
    try {
      const { network, tokenAddress } = input;
      const response = await coingeckoApi.get(`/onchain/networks/${network}/tokens/${tokenAddress}/pools`, {
        timeout: 10000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching DEX pools:", error);
      return { success: false, error: error.message };
    }
  }

  @CreateAction({
    name: "getExchangeData",
    description: "Fetches exchange volumes and trading pairs.",
    schema: z.object({
      exchangeId: z.string().describe("The exchange ID (e.g., 'binance')"),
    }),
  })
  async getExchangeData(input: z.infer<typeof this.getExchangeData.schema>): Promise<any> {
    try {
      const { exchangeId } = input;
      const response = await coingeckoApi.get(`/exchanges/${exchangeId}`, {
        timeout: 5000,
      });
      return { success: true, data: response.data };
    } catch (error: any) {
      console.error("Error fetching exchange data:", error);
      return { success: false, error: error.message };
    }
  }

  supportsNetwork(network: Network): boolean {
    return true;
  }
}

export const coingeckoActionProvider = () => new CoinGeckoActionProvider();