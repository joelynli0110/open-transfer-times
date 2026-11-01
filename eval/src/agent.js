"use strict";

// Runs one question through a Claude tool-use loop whose tools are the real
// open-transfer-times MCP server. Returns a transcript: every tool call with
// its arguments and structured result, and the final answer text.

const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const SERVER_CLI = path.join(__dirname, "..", "..", "packages", "mcp", "src", "cli.js");

const DEFAULT_SYSTEM =
  "You are a helpful travel assistant. Use the available tools when they help answer the question. " +
  "Answer in the language the user writes in.";

async function connectServer() {
  const client = new Client({ name: "open-transfer-times-eval", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_CLI], stderr: "ignore" }));
  const { tools } = await client.listTools();
  return {
    client,
    // MCP tool definitions map one-to-one onto Claude API tool definitions.
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
    close: () => client.close()
  };
}

function textOf(content) {
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
}

/**
 * @param {object} options
 * @param {{ messages: { create: Function } }} options.anthropic  Anthropic SDK client (or a stand-in in tests)
 * @param {{ client: Client, tools: object[] }} options.server   from connectServer()
 * @param {string} options.model
 * @param {string} options.prompt
 */
async function runAgent({ anthropic, server, model, prompt, system = DEFAULT_SYSTEM, maxTurns = 8, maxTokens = 2048 }) {
  const messages = [{ role: "user", content: prompt }];
  const calls = [];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await anthropic.messages.create({ model, max_tokens: maxTokens, system, tools: server.tools, messages });
    usage.input_tokens += response.usage?.input_tokens || 0;
    usage.output_tokens += response.usage?.output_tokens || 0;
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((block) => block.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      return { answer: textOf(response.content), calls, turns: turn + 1, stopReason: response.stop_reason, usage };
    }

    const results = [];
    for (const use of toolUses) {
      let result;
      try {
        result = await server.client.callTool({ name: use.name, arguments: use.input });
      } catch (error) {
        result = { isError: true, content: [{ type: "text", text: String(error.message || error) }] };
      }
      calls.push({ name: use.name, args: use.input, isError: Boolean(result.isError), result: result.structuredContent || null, text: textOf(result.content || []) });
      results.push({ type: "tool_result", tool_use_id: use.id, content: textOf(result.content || []) || "(no text)", is_error: Boolean(result.isError) });
    }
    messages.push({ role: "user", content: results });
  }
  return { answer: "", calls, turns: maxTurns, stopReason: "max_turns", usage };
}

module.exports = { connectServer, runAgent, DEFAULT_SYSTEM };
