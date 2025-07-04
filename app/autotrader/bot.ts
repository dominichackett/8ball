import 'dotenv/config';

// Define the trading parameters

const POLLING_INTERVAL = 1000; // 1 second

interface TokenInfo {
  address: string;
  chain:string;
  // You can add more properties here if needed, e.g., chain: string;
}

const tokens = new Map<string, TokenInfo>([
  ["DOGE", { address: "0x1121AcC14c63f3C872BFcA497d10926A6098AAc5",chain:"mainnet" }],
  ["LINK", { address: "0x514910771af9ca656af840dff83e8264ecf986ca",chain:"mainnet" }],
  ["WETH", { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",chain:"mainnet" }],
  ["SOL", { address: "0x1f54638b7737193ffd86c19ec51907a7c41755d8",chain:"svm" }],
  ["WBTC", { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",chain:"mainnet" }],
  ["USDC", { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",chain:"mainnet" }],
]);

// Function to simulate fetching ETH-USD price
// In a real application, this would be an API call to a price oracle or exchange
async function getPrice(tokenAddress: string, chain: string, specificChain: string): Promise<number> {
  if (!process.env.RECALL_API_KEY) {
    throw new Error("RECALL_API_KEY is not set in the environment variables.");
  }
  try {
    const response = await fetch(`https://api.sandbox.competitions.recall.network/api/price?token=${tokenAddress}&chain=${chain}&specificChain=${specificChain}`, {
      headers: {
        "Authorization": `Bearer ${process.env.RECALL_API_KEY}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch price: ${response.status} ${errorText}`);
    }

    const priceResult = await response.json();
    console.log(priceResult)
    return parseFloat(priceResult.price);
  } catch (error) {
    console.error("Error fetching price:", error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("An unknown error occurred while fetching the price.");
  }
}

// Function to place a trade directly with the Recall Network API
async function pollTokenPrices() {
  console.log("Polling token prices...");

  for (const [tokenName, tokenInfo] of tokens.entries()) {
    if (tokenName === "USDC") {
      continue; // Skip USDC
    }
    try {
      const price = await getPrice(tokenInfo.address, "mainnet", "mainnet"); // Assuming mainnet for now
      console.log(`Current price of ${tokenName} is ${price}`);
    } catch (error) {
      console.error(`Error fetching price for ${tokenName}:`, error);
    }
  }
}

function startBot() {
  console.log("Auto trading bot started.");
  console.log(`Polling every ${POLLING_INTERVAL / 1000} seconds.`);

  pollTokenPrices();
  setInterval(pollTokenPrices, POLLING_INTERVAL);
}

startBot();
