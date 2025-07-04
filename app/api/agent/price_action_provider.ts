
import { ActionProvider, AgentContext, Action, InputSchema } from "@coinbase/agentkit";
import axios from "axios";
import { z } from "zod";

// Define the input schema using Zod for validation
const PriceInputSchema = z.object({
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
});

// Define the output schema for the price data
const PriceOutputSchema = z.object({
  tokenPrice: z.number(),
  chain: z.string(),
  specificChain: z.string(),
  timestamp: z.string(),
  metadata: z.record(z.any()).optional(), // Allow additional metadata
});

export class PriceActionProvider implements ActionProvider {
  id = "price";
  name = "Price";
  description = "Fetches cryptocurrency token prices.";
  inputSchema: InputSchema = {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "Token contract address",
        pattern: "^0x[a-fA-F0-9]{40}$",
      },
      chain: {
        type: "string",
        enum: ["evm", "svm"],
        description: "Blockchain network type",
      },
      specificChain: {
        type: "string",
        enum: [
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
        ],
        description: "Specific blockchain network",
      },
    },
    required: ["token", "chain", "specificChain"],
  };

  async invoke(
    input: z.infer<typeof PriceInputSchema>,
    context: AgentContext
  ): Promise<Action> {
    try {
      // Validate input using Zod
      const validatedInput = PriceInputSchema.parse(input);

      // Ensure chain and specificChain compatibility
      if (
        validatedInput.chain === "evm" &&
        !["eth", "polygon", "bsc", "arbitrum", "optimism", "avalanche", "base", "linea", "zksync", "scroll", "mantle"].includes(validatedInput.specificChain)
      ) {
        throw new Error("Invalid specificChain for EVM chain.");
      }
      if (validatedInput.chain === "svm" && validatedInput.specificChain !== "svm") {
        throw new Error("Invalid specificChain for SVM chain. Must be 'svm'.");
      }

      const { token, chain, specificChain } = validatedInput;

      // Make HTTP request to the price API
      const response = await axios.get("http://localhost:3000/api/price", {
        params: { token, chain, specificChain },
        timeout: 5000, // 5-second timeout
      });

      const priceData = response.data;

      // Format the response
      const formattedResponse = {
        tokenPrice: priceData.price,
        chain: priceData.chain,
        specificChain: priceData.specificChain,
        timestamp: new Date().toISOString(), // Add current timestamp
        metadata: priceData.metadata, // Include any additional metadata
      };

      // Validate and return the formatted response
      return {
        outputs: PriceOutputSchema.parse(formattedResponse),
      };
    } catch (error: any) {
      // Handle errors and provide meaningful messages
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          throw new Error("Network timeout when fetching price.");
        }
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          throw new Error(
            `Error from price API: ${error.response.status} - ${
              error.response.data?.message || error.response.statusText
            }`
          );
        } else if (error.request) {
          // The request was made but no response was received
          throw new Error("No response received from price API.");
        } else {
          // Something happened in setting up the request that triggered an Error
          throw new Error(`Error setting up price API request: ${error.message}`);
        }
      } else if (error instanceof z.ZodError) {
        // Handle Zod validation errors
        throw new Error(`Input validation error: ${error.errors.map(e => e.message).join(", ")}`);
      } else {
        throw new Error(`Failed to fetch token price: ${error.message}`);
      }
    }
  }
}
