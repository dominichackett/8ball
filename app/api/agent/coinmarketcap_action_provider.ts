import { ActionProvider, CreateAction, Network, WalletProvider } from "@coinbase/agentkit";
import { z } from "zod";

const getTokenAddressSchema = z.object({
  symbol: z.string().describe("The symbol of the cryptocurrency, e.g., 'USDC'"),
});

class CoinMarketCapActionProvider extends ActionProvider<WalletProvider> {
    constructor() {
        super("CoinMarketCap", []);
    }

    @CreateAction({
        name: "getTokenAddress",
        description: "Retrieves the Ethereum mainnet contract address for a given cryptocurrency symbol.",
        schema: getTokenAddressSchema,
    })
    async getTokenAddress(args: z.infer<typeof getTokenAddressSchema>): Promise<any> {
        const { symbol } = args;

        if (!process.env.COINMARKETCAP_API_KEY) {
          throw new Error("COINMARKETCAP_API_KEY is not set in the environment variables.");
        }

        try {
          const response = await fetch(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/info?symbol=${symbol}`,
            {
              headers: {
                "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY,
              },
            },
          );

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch token info from CoinMarketCap: ${response.status} ${errorText}`);
          }

          const data = await response.json();

          const tokenData = data.data[symbol.toUpperCase()];

          if (!tokenData || tokenData.length === 0) {
            return { success: false, error: `No data found for symbol: ${symbol}` };
          }

          for (const token of tokenData) {
            if (token.platform) {
              if (token.platform.name === "Ethereum" && token.platform.token_address) {
                return { success: true, address: token.platform.token_address };
              }
            }
          }

          return { success: false, error: `Ethereum mainnet address not found for symbol: ${symbol}` };
        } catch (error) {
          console.error("Error fetching token address:", error);
          if (error instanceof Error) {
            return { success: false, error: error.message };
          }
          return { success: false, error: "An unknown error occurred while fetching the token address." };
        }
    }

    supportsNetwork = (network: Network) => true;
}

export const coinmarketcapActionProvider = () => new CoinMarketCapActionProvider();