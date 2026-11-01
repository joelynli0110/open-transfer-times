"use strict";

// Starts the real open-transfer-times MCP server over stdio for the
// evaluation. The model side lives in providers.js.

const path = require("node:path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

const SERVER_CLI = path.join(__dirname, "..", "..", "packages", "mcp", "src", "cli.js");

async function connectServer() {
  const client = new Client({ name: "open-transfer-times-eval", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER_CLI], stderr: "ignore" }));
  const { tools } = await client.listTools();
  return {
    client,
    tools,                                   // MCP tool definitions; providers convert them
    instructions: client.getInstructions(),  // the server's own usage instructions
    close: () => client.close()
  };
}

module.exports = { connectServer };
