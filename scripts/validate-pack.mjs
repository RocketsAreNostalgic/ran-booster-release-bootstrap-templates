import path from "node:path";
import {
  assert,
  loadJson,
  readRegularFile,
  sha256,
  templateTokens,
  validatePublished,
} from "./contract.mjs";

const packRoot = path.resolve(process.argv[2] ?? "");
assert(process.argv[2], "Expected an extracted pack directory.");
const manifestBytes = await readRegularFile(
  path.join(packRoot, "template-pack.json"),
  "manifest",
);
assert(manifestBytes.length <= 65536, "Manifest is oversized.");
const manifest = await loadJson(path.join(packRoot, "template-pack.json"));
validatePublished(manifest);

const [repositoryId, releaseId, releaseTag, releaseCommit] =
  process.argv.slice(3);
if (
  [repositoryId, releaseId, releaseTag, releaseCommit].some(
    (value) => value !== undefined && value !== "",
  )
) {
  assert(
    manifest.repository.id === repositoryId,
    "Expected repository ID does not match.",
  );
  assert(
    manifest.release.id === Number(releaseId),
    "Expected release ID does not match.",
  );
  assert(
    manifest.release.tag === releaseTag,
    "Expected release tag does not match.",
  );
  assert(
    manifest.release.commit === releaseCommit,
    "Expected release commit does not match.",
  );
}

const declaredPaths = new Set(["template-pack.json"]);
let totalBytes = manifestBytes.length;
for (const profile of Object.values(manifest.profiles)) {
  for (const [logicalId, entry] of Object.entries(profile.entries)) {
    const bytes = await readRegularFile(
      path.join(packRoot, entry.path),
      logicalId,
    );
    assert(bytes.length === entry.size, `Entry size mismatch: ${logicalId}`);
    assert(
      sha256(bytes) === entry.sha256,
      `Entry digest mismatch: ${logicalId}`,
    );
    const text = bytes.toString("utf8");
    assert(
      Buffer.from(text, "utf8").equals(bytes),
      `Entry is not valid UTF-8: ${logicalId}`,
    );
    const actualTokens = [...new Set(templateTokens(text))].sort();
    const declaredTokens = Object.keys(entry.placeholders).sort();
    assert(
      JSON.stringify(actualTokens) === JSON.stringify(declaredTokens),
      `Entry placeholder mismatch: ${logicalId}`,
    );
    if (!declaredPaths.has(entry.path)) totalBytes += bytes.length;
    declaredPaths.add(entry.path);
  }
}

assert(declaredPaths.size <= 32, "Pack has too many members.");
assert(totalBytes <= 1048576, "Pack has too many uncompressed bytes.");

process.stdout.write(`${JSON.stringify([...declaredPaths].sort())}\n`);
