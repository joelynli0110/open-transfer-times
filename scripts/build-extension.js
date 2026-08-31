const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "extension");
const destination = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
const files = new Set(["manifest.json", manifest.action.default_popup]);
for (const contentScript of manifest.content_scripts || []) {
  for (const file of contentScript.js || []) files.add(file);
  for (const file of contentScript.css || []) files.add(file);
}
files.add("src/popup.js");
files.add("src/popup.css");

fs.rmSync(destination, { recursive: true, force: true });
for (const relative of files) {
  const from = path.join(source, relative);
  const to = path.join(destination, relative);
  if (!fs.existsSync(from)) throw new Error(`Manifest dependency is missing: ${relative}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`Built ${files.size} extension files in ${destination}`);
