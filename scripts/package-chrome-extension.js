const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distribution = path.join(root, "dist");
const releaseDirectory = path.join(root, "release");
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const manifestPath = path.join(distribution, "manifest.json");

if (!fs.existsSync(manifestPath)) throw new Error("Production build is missing. Run npm run build first.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== packageMetadata.version) {
  throw new Error(`Package version ${packageMetadata.version} does not match manifest version ${manifest.version}.`);
}
if (manifest.manifest_version !== 3) throw new Error("Chrome package must use Manifest V3.");
if (JSON.stringify(manifest).toLowerCase().includes("skyscanner")) {
  throw new Error("Chrome package manifest must not contain Skyscanner runtime entries.");
}

function listFiles(directory, prefix = "") {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(absolute, relative));
    else if (entry.isFile()) output.push({ absolute, relative });
  }
  return output.sort((left, right) => left.relative.localeCompare(right.relative));
}

const files = listFiles(distribution);
if (!files.some((file) => file.relative === "manifest.json")) {
  throw new Error("manifest.json must be at the ZIP root.");
}

const forbiddenEntry = /(^|\/)(?:node_modules|\.git|tests?|\.venv|data\/(?:raw|processed|public|generated)|\.pytest[^/]*)($|\/)/i;
for (const file of files) {
  if (forbiddenEntry.test(file.relative) || file.relative.toLowerCase().includes("skyscanner")) {
    throw new Error(`Unexpected private or non-production file: ${file.relative}`);
  }
  if (fs.statSync(file.absolute).size > 5 * 1024 * 1024) {
    throw new Error(`Unexpected file larger than 5 MiB: ${file.relative}`);
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.relative, "utf8");
    const data = fs.readFileSync(entry.absolute);
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x0021, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x0021, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

fs.mkdirSync(releaseDirectory, { recursive: true });
const filename = `connection-quality-google-flights-v${manifest.version}-beta.zip`;
const outputPath = path.join(releaseDirectory, filename);
const archive = zipEntries(files);
fs.writeFileSync(outputPath, archive);

const digest = crypto.createHash("sha256").update(archive).digest("hex");
console.log(`Packaged ${files.length} files in ${outputPath}`);
console.log(`SHA-256 ${digest}`);
