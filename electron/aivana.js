const database = require("./database");

// Smoke-test call. maxTokens is 50 on purpose. Replace this with task handlers
// such as extract and chat, then delete it. Those handlers should call
// listRecentChatMessages() when they send history, and only the last 8 turns.
async function generate(prompt) {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("A prompt is required.");
  }
  if (!process.env.AIVANA_API_KEY) {
    throw new Error("AIVANA_API_KEY is not set. Copy .env.example to .env.");
  }

  const { default: Aivana } = await import("@aivana/sdk");
  const client = new Aivana({ apiKey: process.env.AIVANA_API_KEY });
  const response = await client.generate(prompt, { maxTokens: 50 });
  const usage = response.usage || {};

  database.logUsage({
    feature: "chat",
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    credits: usage.credits,
  });

  return response.answer;
}

module.exports = { generate };
