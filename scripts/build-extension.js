const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "extension");
const destination = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
const files = new Set(["manifest.json", manifest.action.default_popup]);

function addManifestAssets(value) {
  if (typeof value === "string") files.add(value);
  else if (value && typeof value === "object") {
    for (const file of Object.values(value)) files.add(file);
  }
}

addManifestAssets(manifest.icons);
addManifestAssets(manifest.action.default_icon);
for (const contentScript of manifest.content_scripts || []) {
  for (const file of contentScript.js || []) files.add(file);
  for (const file of contentScript.css || []) files.add(file);
}
files.add("src/popup.js");
files.add("src/popup.css");

// Manifest paths under core/ are served from the standalone engine package,
// so the extension and the published library always ship the same code.
const coreSource = path.join(root, "packages", "core", "src");
function sourceFor(relative) {
  return relative.startsWith("core/")
    ? path.join(coreSource, relative.slice("core/".length))
    : path.join(source, relative);
}

fs.rmSync(destination, { recursive: true, force: true });
for (const relative of files) {
  const from = sourceFor(relative);
  const to = path.join(destination, relative);
  if (!fs.existsSync(from)) throw new Error(`Manifest dependency is missing: ${relative}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
console.log(`Built ${files.size} extension files in ${destination}`);
