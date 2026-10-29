#!/usr/bin/env node
"use strict";

const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createServer } = require("./server.js");

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; log only to stderr.
  console.error("open-transfer-times MCP server running on stdio");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
