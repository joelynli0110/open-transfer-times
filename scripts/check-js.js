const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repository = path.resolve(__dirname, "..");
const roots = [
  path.join(repository, "extension", "src"),
  path.join(repository, "extension", "tests"),
  path.join(repository, "packages", "core", "src"),
  path.join(repository, "packages", "core", "test"),
  __dirname
];
const files = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(item);
    else if (entry.name.endsWith(".js")) files.push(item);
  }
}
for (const root of roots) visit(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax-checked ${files.length} JavaScript files`);
