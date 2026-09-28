import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAdvisoryIndex } from "../scripts/advisory-index.mjs";
import { parseJson, repositoryName, validatePublished, profileFiles } from "../scripts/contract.mjs";
const encode = (x) => Buffer.from(JSON.stringify(x));
const index = (advisories) => ({ schema: "ran-release-starter-advisories", schema_version: 1, advisories });
const pack = { ghsa_id: "GHSA-2345-6789-cfgh", repository: repositoryName,
  affected: { pack_versions: ["1.2.3"], shared_profile_b_commits: [] },
  fixed: { pack_version: "1.2.4", shared_profile_b_commit: null } };
const workflow = { ghsa_id: "GHSA-jmpq-rvwx-2345", repository: "RocketsAreNostalgic/.github",
  affected: { pack_versions: [], shared_profile_b_commits: ["a".repeat(40)] },
  fixed: { pack_version: null, shared_profile_b_commit: "b".repeat(40) } };
test("canonical empty maintenance index and both exact identity types", async () => {
  validateAdvisoryIndex(await readFile(new URL("../security/release-starter-advisories.json", import.meta.url)));
  const parsed = validateAdvisoryIndex(encode(index([pack, workflow])));
  assert.equal(parsed.advisories[0].fixed.pack_version, "1.2.4");
  assert.equal(parsed.advisories[1].fixed.shared_profile_b_commit, "b".repeat(40));
});
test("malformed, ambiguous, contradictory or over-budget indexes fail closed", () => {
  const mutations = [
    x => { x.extra = true; }, x => { x.schema_version = 2; },
    x => { x.advisories.push(structuredClone(pack)); },
    x => { x.advisories[0].repository = "attacker/repo"; },
    x => { x.advisories[0].affected.pack_versions = ["latest"]; },
    x => { x.advisories[0].affected.pack_versions = ["1.2.3", "1.2.3"]; },
    x => { x.advisories[0].affected.pack_versions = ["1".repeat(64) + ".0.0"]; },
    x => { x.advisories[0].affected.shared_profile_b_commits = ["a".repeat(40)]; },
    x => { x.advisories[0].fixed.pack_version = "1.2.3"; },
    x => { x.advisories[0].fixed.shared_profile_b_commit = "a".repeat(40); },
    x => { x.advisories.push({ ...structuredClone(pack), ghsa_id: workflow.ghsa_id, fixed: { pack_version: "2.0.0", shared_profile_b_commit: null } }); },
    x => { x.advisories = Array(65).fill(pack); },
  ];
  for (const mutate of mutations) { const x = index([structuredClone(pack)]); mutate(x); assert.throws(() => validateAdvisoryIndex(encode(x))); }
  assert.throws(() => validateAdvisoryIndex(Buffer.alloc(65537, 32)));
});
test("JSON decoder rejects duplicate escaped keys and invalid UTF-8", () => {
  for (const bytes of [Buffer.from('{"a":1,"\\u0061":2}'), Buffer.from('{"x":{"a":1,"a":2}}'), Buffer.from([123,34,255,34,58,49,125])]) assert.throws(() => parseJson(bytes));
  assert.deepEqual(parseJson(Buffer.from('{"x":[{"a":1},{"a":2}]}')), { x: [{ a: 1 }, { a: 2 }] });
});

test("published manifest cannot coerce identity types or grant capabilities", async () => {
  const profiles = {};
  for (const file of profileFiles) {
    const profile = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
    profiles[profile.id] = { profile_version: 1, entries: Object.fromEntries(
      Object.entries(profile.entries).map(([id, entry]) => [id, { path: entry.path, size: 1, sha256: "a".repeat(64), placeholders: entry.placeholders }]),
    ) };
  }
  const manifest = { schema_version: 1, consumer_api: 3, pack_version: "0.2.1", repository: { name: repositoryName, id: "1322743261" }, release: { tag: "v0.2.1", commit: "a".repeat(40) }, profiles };
  validatePublished(manifest);
  for (const change of [
    m => { m.consumer_api = 2; },
    m => { m.release.id = 1; },
    m => { m.release.commit = [m.release.commit]; },
    m => { m.repository.id = 1322743261; },
    m => { m.profiles["source-ready-wordpress-plugin/3"].entries["quality-workflow"].sha256 = ["a".repeat(64)]; },
    m => { m.profiles["source-ready-wordpress-plugin/3"].entries["quality-workflow"].destination = ".github/workflows/evil.yml"; },
    m => { m.profiles["source-ready-wordpress-plugin/3"].entries["quality-workflow"].path = "templates/shared/other.yml.tmpl"; },
    m => { m.profiles["source-ready-wordpress-plugin/3"].entries["quality-workflow"].placeholders.EXTRA = "slug"; },
    m => { m.permissions = { contents: "write" }; },
  ]) { const changed = structuredClone(manifest); change(changed); assert.throws(() => validatePublished(changed)); }
});
