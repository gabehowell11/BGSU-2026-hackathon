const database = require("./database");

let client;

// The code Aivana gives when a json_schema answer did not fit its size limit or
// did not match the schema. Sending the same request again fails the same way.
const ANSWER_TOO_LONG = "structured_output_failed";

// True for failures worth sending again unchanged (provider or network hiccups).
function isTemporaryError(error) {
  if (error?.code === ANSWER_TOO_LONG) return false;
  return error?.constructor?.name === "UpstreamError"
    || error?.code === "upstream_error"
    || error?.status === 502
    || error?.status === 503
    || error?.status === 504;
}

// True when Aivana refused a request because of its rate limit. The account
// runs at most 4 requests at once (shared by everyone using the same key), so
// this usually clears as soon as another request finishes.
function isBusyError(error) {
  return error?.code === "rate_limit_exceeded" || error?.status === 429;
}

// Sends a request, trying again after a temporary failure (up to 3 tries) or
// when the account is busy (up to 6 tries, waiting longer each time).
async function retryTemporary(send) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      const busy = isBusyError(error);
      if (busy ? attempt >= 6 : !isTemporaryError(error) || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, (busy ? 2000 : 750) * attempt));
    }
  }
}

// Returns one shared Aivana client, created on first use.
async function getClient() {
  if (!process.env.AIVANA_API_KEY) {
    throw new Error("AIVANA_API_KEY is not set. Copy .env.example to .env.");
  }
  if (!client) {
    const { default: Aivana } = await import("@aivana/sdk");
    client = new Aivana({ apiKey: process.env.AIVANA_API_KEY, timeoutMs: 90_000 });
  }
  return client;
}

// Records the token counts and credits from one Aivana response.
function logResponseUsage(feature, response) {
  const usage = response?.usage || {};
  try {
    database.logUsage({
      feature,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      credits: usage.credits,
    });
  } catch (error) {
    console.error(`Could not log Aivana usage: ${error.message}`);
  }
}

// Returns a copy of a JSON schema without keywords some validators refuse.
function looseSchema(schema) {
  if (Array.isArray(schema)) return schema.map(looseSchema);
  if (!schema || typeof schema !== "object") return schema;
  const copy = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "pattern" || key === "minimum" || key === "maximum") continue;
    copy[key] = looseSchema(value);
  }
  return copy;
}

// Calls Aivana for JSON that matches the schema and returns the parsed object.
// Retries once with a looser schema if Aivana rejects the schema itself.
async function generateStructured({ feature, prompt, schema, ...options }) {
  if (typeof prompt === "string" && prompt.length > 20000) {
    throw new Error("Aivana prompt limit exceeded. The document must be split into smaller chunks.");
  }
  const aivana = await getClient();
  const send = (format) => aivana.generate(prompt ?? null, {
    ...options,
    responseFormat: { type: "json_schema", schema: format },
  });

  let response;
  try {
    response = await retryTemporary(() => send(schema));
  } catch (error) {
    if (error?.code !== "invalid_response_schema") throw friendlyError(error);
    try {
      response = await retryTemporary(() => send(looseSchema(schema)));
    } catch (retryError) {
      throw friendlyError(retryError);
    }
  }

  logResponseUsage(feature, response);

  let data = response.structured;
  if (!data && typeof response.answer === "string") {
    try {
      data = JSON.parse(response.answer);
    } catch {
      data = null;
    }
  }
  if (!data || typeof data !== "object") {
    throw new Error(`Aivana did not return usable data${response.structured_error ? `: ${response.structured_error}` : "."}`);
  }

  return { data, response };
}

// Turns SDK errors into short messages the renderer can show as-is.
function friendlyError(error) {
  const name = error?.constructor?.name;
  if (error?.code === ANSWER_TOO_LONG) {
    return new Error("Aivana could not produce an answer in the required format. Try a shorter or simpler request.");
  }
  if (name === "AuthError") return new Error("Aivana rejected the API key. Check AIVANA_API_KEY in .env.");
  if (name === "RateLimitError") return new Error("Aivana's rate limit or quota was reached. Try again shortly.");
  if (name === "UpstreamError") return new Error("Aivana had a temporary problem. Try again.");
  if (error?.name === "AbortError" || error?.code === "timeout") {
    return new Error("Aivana timed out. Try a smaller or text-based file.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

// Returns a plain-text answer in one piece, with no schema checking.
async function generateText({ feature, prompt = null, ...options }) {
  const aivana = await getClient();
  let response;
  try {
    response = await retryTemporary(() => aivana.generate(prompt, options));
  } catch (error) {
    throw friendlyError(error);
  }
  logResponseUsage(feature, response);
  return typeof response.answer === "string" ? response.answer : "";
}

// Streams a plain-text answer. Calls onDelta(text) for each piece as it
// arrives and resolves with the full text. A temporary failure is retried only
// before anything has been shown, so the user never sees text repeated.
async function streamText({ feature, prompt = null, onDelta, ...options }) {
  const aivana = await getClient();
  for (let attempt = 0; ; attempt += 1) {
    let full = "";
    try {
      for await (const chunk of aivana.generateStream(prompt, options)) {
        if (chunk.event === "delta" && typeof chunk.data?.text === "string") {
          full += chunk.data.text;
          onDelta?.(chunk.data.text);
        } else if (chunk.event === "done") {
          logResponseUsage(feature, chunk.data?.usage ? chunk.data : { usage: chunk.data });
        } else if (chunk.event === "error") {
          const streamError = new Error(chunk.data?.message || "Aivana had a temporary problem. Try again.");
          streamError.code = chunk.data?.code || "upstream_error";
          throw streamError;
        }
      }
      return full;
    } catch (error) {
      if (full || attempt >= 2 || !isTemporaryError(error)) throw friendlyError(error);
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
}

module.exports = {
  getClient,
  generateStructured,
  generateText,
  streamText,
  friendlyError,
  logResponseUsage,
};
