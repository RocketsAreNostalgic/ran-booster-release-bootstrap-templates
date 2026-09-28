import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { assert, parseJson, sha256, validatePublished, templateTokens } from "./contract.mjs";

const [archive, destination] = process.argv.slice(2);
assert(archive && destination, "Expected verified ZIP path and evidence directory.");
execFileSync(process.execPath, [new URL("./inspect-pack-archive.mjs", import.meta.url).pathname, archive]);
const bytes = await readFile(archive);
const manifestBytes = execFileSync("unzip", ["-p", archive, "template-pack.json"]);
const manifest = parseJson(manifestBytes, 65536);
validatePublished(manifest);
const base = parseJson(await readFile(new URL("../tests/fixtures/render-values.json", import.meta.url)));
const profiles = {};
for (const [id, profile] of Object.entries(manifest.profiles)) {
  const type = id.includes("theme") ? "theme" : "plugin";
  const header = type === "theme" ? "style.css" : "example-package.php";
  const values = { ...base, PACKAGE_TYPE: type, HEADER_PATH: header,
    EXTRA_FILES_JSON: JSON.stringify([{ type: "generic", path: header }]) };
  const renderedDir = path.join(destination, "rendered", type);
  await mkdir(renderedDir, { recursive: true });
  profiles[id] = {};
  for (const [logical, entry] of Object.entries(profile.entries)) {
    const content = execFileSync("unzip", ["-p", archive, entry.path]);
    assert(content.length === entry.size && sha256(content) === entry.sha256, "Member integrity mismatch.");
    let text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    assert(!text.includes("\0"), "NUL template.");
    for (const token of new Set(templateTokens(text))) {
      assert(Object.hasOwn(values, token), "Unknown substitution.");
      text = text.split(`{{RAN_${token}}}`).join(values[token]);
    }
    assert(templateTokens(text).length === 0, "Unresolved token.");
    const filename = path.basename(entry.path, ".tmpl");
    await writeFile(path.join(renderedDir, filename), text);
    profiles[id][logical] = { sha256: entry.sha256, rendered_sha256: sha256(Buffer.from(text)) };
  }
}
const envelope = { producer_sha: manifest.release.commit,
  workflow_run_id: process.env.GITHUB_RUN_ID ?? null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  artifact_id: null,
  artifact_id_note: "Resolve after upload from this exact run and attempt; no synthetic transport identity.",
  filename: path.basename(archive), size: bytes.length, zip_sha256: sha256(bytes),
  manifest_sha256: sha256(manifestBytes), pack_version: manifest.pack_version, profiles,
  rendering: "Producer fixture proof only. Actual candidate Provider consumption remains separate." };
await writeFile(path.join(destination, "producer-exchange.json"), JSON.stringify(envelope, null, 2) + "\n");
const promotion = { schema: "ran-profile-b-promotion", schema_version: 1,
  repository: manifest.repository.name, quality_commit: manifest.release.commit,
  source_commit: manifest.release.commit, tag: manifest.release.tag,
  assets: [{ name: path.basename(archive), sha256: sha256(bytes) }] };
await writeFile(path.join(destination, "ran-profile-b-promotion.json"), JSON.stringify(promotion, null, 2) + "\n");
console.log(JSON.stringify(envelope, null, 2));
