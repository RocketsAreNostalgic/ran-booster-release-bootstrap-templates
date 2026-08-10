import { readFile, stat } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const limits = Object.freeze({
  archiveBytes: 2 * 1024 * 1024,
  members: 32,
  memberBytes: 256 * 1024,
  totalBytes: 1024 * 1024,
  ratio: 200,
});
const crcTable = buildCrcTable();

const archivePath = process.argv[2];
if (!archivePath) fail("archive_path_missing");

try {
  const entries = await inspectArchive(archivePath);
  for (const entry of entries)
    process.stdout.write(`${entry.directory ? "D" : "F"}\t${entry.name}\n`);
} catch (error) {
  fail(error?.code ?? "archive_invalid");
}

async function inspectArchive(file) {
  const size = (await stat(file)).size;
  if (size === 0 || size > limits.archiveBytes)
    throw archiveError("archive_size");
  const bytes = await readFile(file);
  const eocd = findEocd(bytes);
  if (
    eocd < 0 ||
    bytes.readUInt16LE(eocd + 20) !== 0 ||
    eocd + 22 !== bytes.length
  )
    throw archiveError("directory_missing");

  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const diskEntries = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  )
    throw archiveError("multidisk_or_zip64");
  if (
    entryCount === 0 ||
    entryCount > limits.members ||
    centralOffset + centralSize !== eocd
  )
    throw archiveError("directory_bounds");

  const entries = [];
  const rawNames = new Set();
  const logicalNames = new Map();
  let offset = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > eocd || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw archiveError("directory_record");
    const madeBy = bytes.readUInt16LE(offset + 4);
    const needed = bytes.readUInt16LE(offset + 6);
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (
      needed >= 45 ||
      nameLength === 0 ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      next > eocd
    )
      throw archiveError("directory_record");

    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeName(nameBytes);
    const directory = name.endsWith("/");
    validateName(name);
    if (rawNames.has(name)) throw archiveError("duplicate_member");
    rawNames.add(name);
    const logical = name.slice(0, directory ? -1 : undefined).toLowerCase();
    if (logicalNames.has(logical)) throw archiveError("normalized_collision");
    logicalNames.set(logical, directory ? "directory" : "file");
    validateType(madeBy, externalAttributes, directory);
    if ((flags & ~0x0800) !== 0 || ![0, 8].includes(method))
      throw archiveError("unsupported_member");
    if (
      uncompressedSize > limits.memberBytes ||
      compressedSize > limits.archiveBytes ||
      (compressedSize === 0
        ? uncompressedSize > 0
        : uncompressedSize / compressedSize > limits.ratio)
    )
      throw archiveError("member_budget");
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0))
      throw archiveError("directory_payload");
    totalBytes += uncompressedSize;
    if (totalBytes > limits.totalBytes) throw archiveError("total_budget");
    entries.push({
      name,
      directory,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = next;
  }
  if (offset !== eocd) throw archiveError("directory_size");
  validateHierarchy(logicalNames);
  validateLocalRecords(bytes, entries, centralOffset);
  return entries;
}

function validateLocalRecords(bytes, entries, centralOffset) {
  const ordered = [...entries].sort(
    (left, right) => left.localOffset - right.localOffset,
  );
  let expectedOffset = 0;
  for (const entry of ordered) {
    const offset = entry.localOffset;
    if (offset !== expectedOffset || offset + 30 > centralOffset)
      throw archiveError("local_bounds");
    if (bytes.readUInt32LE(offset) !== 0x04034b50)
      throw archiveError("local_header");
    const needed = bytes.readUInt16LE(offset + 4);
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const crc = bytes.readUInt32LE(offset + 14);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (
      needed >= 45 ||
      extraLength !== 0 ||
      flags !== entry.flags ||
      method !== entry.method ||
      crc !== entry.crc ||
      compressedSize !== entry.compressedSize ||
      uncompressedSize !== entry.uncompressedSize ||
      dataEnd > centralOffset ||
      decodeName(bytes.subarray(nameStart, nameStart + nameLength)) !==
        entry.name
    )
      throw archiveError("local_mismatch");
    const compressed = bytes.subarray(dataStart, dataEnd);
    let output;
    try {
      output =
        method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: limits.memberBytes });
    } catch {
      throw archiveError("member_decompression");
    }
    if (output.length !== uncompressedSize || crc32(output) !== crc)
      throw archiveError("member_integrity");
    expectedOffset = dataEnd;
  }
  if (expectedOffset !== centralOffset) throw archiveError("local_layout");
}

function validateName(name) {
  if (
    name !== name.normalize("NFC") ||
    name.length > 4096 ||
    !/^[A-Za-z0-9._/-]+$/.test(name) ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.includes("\\") ||
    name.includes("\0")
  )
    throw archiveError("member_path");
  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  const parts = path.split("/");
  if (
    path === "" ||
    parts.some(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".." ||
        part.length > 255 ||
        part.endsWith(".") ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  )
    throw archiveError("member_path");
}

function validateHierarchy(logicalNames) {
  for (const [name] of logicalNames) {
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (logicalNames.get(parent) === "file")
        throw archiveError("member_hierarchy");
    }
  }
}

function validateType(madeBy, attributes, directory) {
  const host = madeBy >>> 8;
  const mode = attributes >>> 16;
  const type = mode & 0o170000;
  const dosDirectory = (attributes & 0x10) !== 0;
  if (host !== 3 || directory !== dosDirectory)
    throw archiveError("member_type");
  if (directory ? type !== 0o040000 : type !== 0o100000)
    throw archiveError("member_type");
  if (!directory && (mode & 0o111) !== 0)
    throw archiveError("member_executable");
}

function decodeName(bytes) {
  const name = bytes.toString("utf8");
  if (!Buffer.from(name, "utf8").equals(bytes))
    throw archiveError("name_encoding");
  return name;
}

function findEocd(bytes) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1)
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  return -1;
}

function buildCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function archiveError(code) {
  return Object.assign(new Error(code), { code });
}

function fail(code) {
  process.stderr.write(`inspect-pack-archive: ${code}\n`);
  process.exit(1);
}
