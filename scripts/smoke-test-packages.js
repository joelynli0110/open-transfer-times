#!/usr/bin/env node
// Packs packages/core and packages/mcp exactly as `npm publish` would, installs
// the tarballs into an empty project, starts the installed MCP server over
// stdio and calls a tool. Catches missing files, wrong `files`/`bin` entries and
// broken dependency ranges before a release.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args, cwd) => execFileSync(npm, args, { cwd, encoding: "utf8", shell: process.platform === "win32" });

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ott-smoke-"));
try {
  const tarballs = ["core", "mcp"].map((name) => {
    const output = run(["pack", "--json", "--pack-destination", scratch], path.join(root, "packages", name));
    return path.join(scratch, JSON.parse(output)[0].filename);
  });

  const project = path.join(scratch, "project");
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "smoke", version: "0.0.0", private: true }));
  // Install both local tarballs so the MCP package resolves the core version
  // being released, plus the SDK client used to talk to the server.
  run(["install", "--no-audit", "--no-fund", ...tarballs], project);

  const client = `
    const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
    const path = require("node:path");
    (async () => {
      const bin = path.join("node_modules", "open-transfer-times-mcp", "src", "cli.js");
      const client = new Client({ name: "smoke", version: "0.0.0" });
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin], stderr: "ignore" }));
      const { tools } = await client.listTools();
      if (tools.length !== 4) throw new Error("expected 4 tools, got " + tools.length);
      const result = await client.callTool({ name: "check_connection", arguments: { from: "BER", via: "LHR", to: "PVG", layover_minutes: 90, ticket: "protected" } });
      if (result.isError || result.structuredContent.quality !== "reasonable") throw new Error(JSON.stringify(result));
      const core = require("open-transfer-times");
      if (core.listAirportProfiles().length < 13) throw new Error("airport data missing from core package");
      await client.close();
      console.log("Smoke test passed: packed packages install and the MCP server answers over stdio.");
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  execFileSync(process.execPath, ["-e", client], { cwd: project, stdio: "inherit" });
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
