import { ActionProvider, CreateAction, Network, WalletProvider } from "@coinbase/agentkit";
import { z } from "zod";

const placeTradeSchema = z.object({
  market: z.string().describe("The market to trade on, e.g., 'ETH-USD'"),
  side: z.enum(["BUY", "SELL"]).describe("The side of the trade, either 'BUY' or 'SELL'"),
  quantity: z.number().describe("The amount to trade"),
});

class RecallActionProvider extends ActionProvider<WalletProvider> {
    constructor() {
        super("RecallNetwork", []);
    }

    @CreateAction({
        name: "getAccountInfo",
        description: "Retrieves the current user's account information from the Recall Network.",
        schema: z.object({}), // No input needed for this action
    })
    async getAccountInfo(): Promise<any> {
        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/agent/profile`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch account info: ${response.status} ${errorText}`);
            }

            const accountInfo = await response.json();
            return { success: true, accountInfo };
        } catch (error) {
            console.error("Error fetching account info:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching account information." };
        }
    }

    @CreateAction({
        name: "getBalances",
        description: "Retrieves the current user's token balances from the Recall Network.",
        schema: z.object({}), // No input needed for this action
    })
    async getBalances(): Promise<any> {
        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/agent/balances`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch balances: ${response.status} ${errorText}`);
            }

            const balances = await response.json();
            return { success: true, balances };
        } catch (error) {
            console.error("Error fetching balances:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching balances." };
        }
    }

    @CreateAction({
        name: "getPortfolio",
        description: "Retrieves the current user's portfolio information from the Recall Network.",
        schema: z.object({}), // No input needed for this action
    })
    async getPortfolio(): Promise<any> {
        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/agent/portfolio`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch portfolio: ${response.status} ${errorText}`);
            }

            const portfolio = await response.json();
            return { success: true, portfolio };
        } catch (error) {
            console.error("Error fetching portfolio:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching portfolio information." };
        }
    }

    @CreateAction({
        name: "placeTrade",
        description: "Places a trade on the Recall Network.",
        schema: placeTradeSchema,
    })
    async placeTrade(args: z.infer<typeof placeTradeSchema>): Promise<any> {
        const { market, side, quantity } = args;

        if (!process.env.RECALL_API_KEY) {
          throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
          const response = await fetch(`${process.env.RECALL_URL}/trades`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
            },
            body: JSON.stringify({
              market,
              side,
              quantity,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to place trade: ${response.status} ${errorText}`);
          }

          const tradeResult = await response.json();
          return { success: true, trade: tradeResult };
        } catch (error) {
          console.error("Error placing trade:", error);
          if (error instanceof Error) {
            return { success: false, error: error.message };
          }
          return { success: false, error: "An unknown error occurred while placing the trade." };
        }
    }

    

    

    @CreateAction({
        name: "getPrice",
        description: "Retrieves price information for a specified token.",
        schema: z.object({
            token: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
            chain: z.enum(["evm", "svm"]),
            specificChain: z.enum([
                "eth",
                "polygon",
                "bsc",
                "arbitrum",
                "optimism",
                "avalanche",
                "base",
                "linea",
                "zksync",
                "scroll",
                "mantle",
                "svm",
            ]),
        }),
    })
    async getPrice(args: z.infer<typeof this.getPrice.schema>): Promise<any> {
        const { token, chain, specificChain } = args;

        // Ensure chain and specificChain compatibility
        if (
            chain === "evm" &&
            !["eth", "polygon", "bsc", "arbitrum", "optimism", "avalanche", "base", "linea", "zksync", "scroll", "mantle"].includes(specificChain)
        ) {
            throw new Error("Invalid specificChain for EVM chain.");
        }
        if (chain === "svm" && specificChain !== "svm") {
            throw new Error("Invalid specificChain for SVM chain. Must be 'svm'.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/price?token=${token}&chain=${chain}&specificChain=${specificChain}`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch price: ${response.status} ${errorText}`);
            }

            const priceData = await response.json();
            return { success: true, price: priceData };
        } catch (error) {
            console.error("Error fetching price:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching price information." };
        }
    }

    @CreateAction({
        name: "executeTrade",
        description: "Executes a token trade on the Recall network.",
        schema: z.object({
            fromToken: z.string().min(1, "fromToken is required"),
            toToken: z.string().min(1, "toToken is required"),
            amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "Amount must be a positive number"),
            reason: z.string().min(10, "Reason must be at least 10 characters").max(500, "Reason cannot exceed 500 characters"),
            slippageTolerance: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "Slippage tolerance must be a number").optional(),
            fromChain: z.string().optional(),
            fromSpecificChain: z.string().optional(),
            toChain: z.string().optional(),
            toSpecificChain: z.string().optional(),
        }),
    })
    async executeTrade(args: z.infer<typeof this.executeTrade.schema>): Promise<any> {
        const { fromToken, toToken, amount, reason, slippageTolerance, fromChain, fromSpecificChain, toChain, toSpecificChain } = args;

        // Validation Rules
        if (parseFloat(amount) <= 0) {
            throw new Error("Amount must be a positive number.");
        }
        if (fromToken === toToken) {
            throw new Error("fromToken and toToken cannot be the same.");
        }
        if (slippageTolerance !== undefined) {
            const slippage = parseFloat(slippageTolerance);
            if (slippage < 0 || slippage > 100) {
                throw new Error("Slippage tolerance must be between 0 and 100.");
            }
        }

        // Check chain consistency (basic check)
        if ((fromChain && !fromSpecificChain) || (!fromChain && fromSpecificChain)) {
            throw new Error("Both fromChain and fromSpecificChain must be provided if one is.");
        }
        if ((toChain && !toSpecificChain) || (!toChain && toSpecificChain)) {
            throw new Error("Both toChain and toSpecificChain must be provided if one is.");
        }

        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/trade/execute`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
                body: JSON.stringify({
                    fromToken,
                    toToken,
                    amount,
                    reason,
                    slippageTolerance,
                    fromChain,
                    fromSpecificChain,
                    toChain,
                    toSpecificChain,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to execute trade: ${response.status} ${errorText}`);
            }

            const tradeResult = await response.json();
            return { success: true, transaction: tradeResult };
        } catch (error) {
            console.error("Error executing trade:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while executing the trade." };
        }
    }

    @CreateAction({
        name: "getTradeQuote",
        description: "Retrieves trading quotes for token pairs on the Recall network.",
        schema: z.object({
            fromToken: z.string().min(1, "fromToken is required"),
            toToken: z.string().min(1, "toToken is required"),
            amount: z.string().regex(/^[0-9]+(\.[0-9]+)?$/, "Amount must be a positive number"),
            fromChain: z.string().optional(),
            fromSpecificChain: z.string().optional(),
            toChain: z.string().optional(),
            toSpecificChain: z.string().optional(),
        }),
    })
    async getTradeQuote(args: z.infer<typeof this.getTradeQuote.schema>): Promise<any> {
        const { fromToken, toToken, amount, fromChain, fromSpecificChain, toChain, toSpecificChain } = args;

        // Validation Rules
        if (parseFloat(amount) <= 0) {
            throw new Error("Amount must be a positive number.");
        }
        if (fromToken === toToken) {
            throw new Error("fromToken and toToken cannot be the same.");
        }

        // Check chain consistency (basic check)
        if ((fromChain && !fromSpecificChain) || (!fromChain && fromSpecificChain)) {
            throw new Error("Both fromChain and fromSpecificChain must be provided if one is.");
        }
        if ((toChain && !toSpecificChain) || (!toChain && toSpecificChain)) {
            throw new Error("Both toChain and toSpecificChain must be provided if one is.");
        }

        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const queryParams = new URLSearchParams({
                fromToken,
                toToken,
                amount,
            });
            if (fromChain) queryParams.append("fromChain", fromChain);
            if (fromSpecificChain) queryParams.append("fromSpecificChain", fromSpecificChain);
            if (toChain) queryParams.append("toChain", toChain);
            if (toSpecificChain) queryParams.append("toSpecificChain", toSpecificChain);

            const response = await fetch(`${process.env.RECALL_URL}/trade/quote?${queryParams.toString()}`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch trade quote: ${response.status} ${errorText}`);
            }

            const quoteData = await response.json();
            return { success: true, quote: quoteData };
        } catch (error) {
            console.error("Error fetching trade quote:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching the trade quote." };
        }
    }

    @CreateAction({
        name: "getTradingHistory",
        description: "Retrieves the trading history for the authenticated agent from the Recall Network.",
        schema: z.object({}), // No input needed for this action
    })
    async getTradingHistory(): Promise<any> {
        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/agent/history`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch trading history: ${response.status} ${errorText}`);
            }

            const tradingHistory = await response.json();
            return { success: true, history: tradingHistory };
        } catch (error) {
            console.error("Error fetching trading history:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching trading history." };
        }
    }

    @CreateAction({
        name: "getAgentTrades",
        description: "Retrieves the current user's trade history from the Recall Network.",
        schema: z.object({}), // No input needed for this action
    })
    async getAgentTrades(): Promise<any> {
        if (!process.env.RECALL_API_KEY) {
            throw new Error("RECALL_API_KEY is not set in the environment variables.");
        }

        try {
            const response = await fetch(`${process.env.RECALL_URL}/agent/trades`, {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
                },
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch agent trades: ${response.status} ${errorText}`);
            }

            const trades = await response.json();
            return { success: true, trades };
        } catch (error) {
            console.error("Error fetching agent trades:", error);
            if (error instanceof Error) {
                return { success: false, error: error.message };
            }
            return { success: false, error: "An unknown error occurred while fetching agent trades." };
        }
    }

    supportsNetwork = (network: Network) => true;
}

export const recallActionProvider = () => new RecallActionProvider();