"use strict";

// Model providers for the evaluation. Each provider exposes:
//   runAgent({ server, prompt, system, maxTurns }) → transcript
//   complete(prompt)                               → text (used by the judge)
//
// Two implementations cover most options:
//   - Anthropic (Messages API, via @anthropic-ai/sdk)
//   - any OpenAI-compatible Chat Completions endpoint, via fetch: OpenAI,
//     OpenRouter, a local Ollama, and other compatible services.

const DEFAULT_SYSTEM =
  "You are a helpful travel assistant. Use the available tools when they help answer the question. " +
  "Answer in the language the user writes in.";

// Presets for --provider. Models are not defaulted (except Anthropic's), so a
// comparison never silently runs a model you did not choose.
const PRESETS = {
  anthropic: { kind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5-5" },
  openai: { kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  openrouter: { kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  // 127.0.0.1, not localhost: Node may resolve localhost to IPv6 (::1) while Ollama listens on IPv4.
  ollama: { kind: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", apiKeyEnv: null },
  compatible: { kind: "openai-compatible", baseUrl: null, apiKeyEnv: "OPENAI_API_KEY" }
};

// Reasoning models (e.g. qwen3) may put their thinking in the content as
// <think>…</think>. It is neither the answer nor valid judge output.
function stripThinking(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
}

function textOf(content) {
  return (content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}

async function callTool(server, name, args) {
  try {
    const result = await server.client.callTool({ name, arguments: args });
    return { name, args, isError: Boolean(result.isError), result: result.structuredContent || null, text: textOf(result.content) };
  } catch (error) {
    return { name, args, isError: true, result: null, text: String(error.message || error) };
  }
}

// --- Anthropic ----------------------------------------------------------------

function anthropicProvider({ client, model, maxTokens = 2048 }) {
  return {
    name: `anthropic:${model}`,
    model,
    async runAgent({ server, prompt, system = DEFAULT_SYSTEM, maxTurns = 8 }) {
      const tools = server.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
      const messages = [{ role: "user", content: prompt }];
      const calls = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const response = await client.messages.create({ model, max_tokens: maxTokens, system, tools, messages });
        usage.input_tokens += response.usage?.input_tokens || 0;
        usage.output_tokens += response.usage?.output_tokens || 0;
        messages.push({ role: "assistant", content: response.content });
        const toolUses = response.content.filter((block) => block.type === "tool_use");
        if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
          return { answer: textOf(response.content), calls, turns: turn + 1, stopReason: response.stop_reason, usage };
        }
        const results = [];
        for (const use of toolUses) {
          const call = await callTool(server, use.name, use.input);
          calls.push(call);
          results.push({ type: "tool_result", tool_use_id: use.id, content: call.text || "(no text)", is_error: call.isError });
        }
        messages.push({ role: "user", content: results });
      }
      return { answer: "", calls, turns: maxTurns, stopReason: "max_turns", usage };
    },
    async complete(prompt) {
      const response = await client.messages.create({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
      return textOf(response.content);
    }
  };
}

// --- OpenAI-compatible ----------------------------------------------------------

// MCP tool schemas are JSON Schema; drop the "$schema" marker some endpoints reject.
function toFunctionTool(tool) {
  const { $schema: _ignored, ...parameters } = tool.inputSchema || { type: "object", properties: {} };
  return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
}

function parseArguments(raw) {
  if (raw && typeof raw === "object") return { args: raw };
  try {
    return { args: raw ? JSON.parse(raw) : {} };
  } catch {
    return { args: {}, error: `Invalid JSON arguments: ${String(raw).slice(0, 200)}` };
  }
}

// noThink appends Qwen3's documented "/no_think" switch to the system and user
// prompts, so the model answers without a long reasoning phase.
function openAICompatibleProvider({ baseUrl, apiKey, model, label, fetchImpl = globalThis.fetch, headers = {}, noThink = false }) {
  if (!baseUrl) throw new Error("An OpenAI-compatible provider needs a base URL (--base-url).");
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const think = (text) => (noThink ? `${text}\n/no_think` : text);

  async function chat(body) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), ...headers },
        body: JSON.stringify({ model, ...body })
      });
    } catch (error) {
      const code = error.cause?.code || error.code || error.message;
      throw new Error(`Could not reach ${endpoint} (${code}). Is the server running? For Ollama, check that ` +
        `"ollama list" works, or pass --base-url.`);
    }
    const text = await response.text();
    if (!response.ok) throw new Error(`${label || baseUrl} returned ${response.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  return {
    name: `${label || "openai-compatible"}:${model}`,
    model,
    async runAgent({ server, prompt, system = DEFAULT_SYSTEM, maxTurns = 8 }) {
      const tools = server.tools.map(toFunctionTool);
      const messages = [{ role: "system", content: think(system) }, { role: "user", content: think(prompt) }];
      const calls = [];
      const usage = { input_tokens: 0, output_tokens: 0 };
      for (let turn = 0; turn < maxTurns; turn += 1) {
        const data = await chat({ messages, tools });
        usage.input_tokens += data.usage?.prompt_tokens || 0;
        usage.output_tokens += data.usage?.completion_tokens || 0;
        const choice = data.choices?.[0];
        const message = choice?.message || { role: "assistant", content: "" };
        const toolCalls = message.tool_calls || [];
        messages.push({ role: "assistant", content: message.content ?? null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
        if (!toolCalls.length) {
          return { answer: stripThinking(message.content), calls, turns: turn + 1, stopReason: choice?.finish_reason || "stop", usage };
        }
        for (const toolCall of toolCalls) {
          const { args, error } = parseArguments(toolCall.function?.arguments);
          const call = error
            ? { name: toolCall.function?.name, args, isError: true, result: null, text: error }
            : await callTool(server, toolCall.function?.name, args);
          calls.push(call);
          messages.push({ role: "tool", tool_call_id: toolCall.id, content: call.text || "(no text)" });
        }
      }
      return { answer: "", calls, turns: maxTurns, stopReason: "max_turns", usage };
    },
    async complete(prompt) {
      const data = await chat({ messages: [{ role: "user", content: think(prompt) }] });
      return stripThinking(data.choices?.[0]?.message?.content);
    }
  };
}

/**
 * Builds a provider from CLI-style options.
 * @param {{ provider?: string, model?: string, baseUrl?: string, apiKeyEnv?: string }} options
 */
function createProvider({ provider = "anthropic", model, baseUrl, apiKeyEnv, env = process.env, fetchImpl, anthropicClient, noThink = false } = {}) {
  const preset = PRESETS[provider];
  if (!preset) throw new Error(`Unknown provider "${provider}". Use one of: ${Object.keys(PRESETS).join(", ")}.`);
  const chosenModel = model || preset.defaultModel;
  if (!chosenModel) throw new Error(`--model is required for provider "${provider}".`);
  const keyEnv = apiKeyEnv || preset.apiKeyEnv;
  const apiKey = keyEnv ? env[keyEnv] : undefined;
  if (keyEnv && !apiKey) throw new Error(`Set ${keyEnv} to use provider "${provider}".`);

  if (preset.kind === "anthropic") {
    const client = anthropicClient || new (require("@anthropic-ai/sdk").default)({ apiKey });
    return anthropicProvider({ client, model: chosenModel });
  }
  return openAICompatibleProvider({ baseUrl: baseUrl || preset.baseUrl, apiKey, model: chosenModel, label: provider, fetchImpl, noThink });
}

module.exports = { createProvider, anthropicProvider, openAICompatibleProvider, PRESETS, DEFAULT_SYSTEM, toFunctionTool, stripThinking };
