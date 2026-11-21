import "dotenv/config";
import Aivana from "@aivana/sdk";

// Sends one short prompt to Aivana and prints the answer.
async function main() {
  if (!process.env.AIVANA_API_KEY) {
    throw new Error("AIVANA_API_KEY is not set. Copy .env.example to .env.");
  }

  const client = new Aivana({ apiKey: process.env.AIVANA_API_KEY });
  const response = await client.generate("Say hello in five words.", {
    maxTokens: 50,
  });

  console.log("Answer:", response.answer);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
