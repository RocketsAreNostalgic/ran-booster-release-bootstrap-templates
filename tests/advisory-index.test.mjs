import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAdvisoryIndex } from "../scripts/advisory-index.mjs";
import { parseJson, repositoryName, validatePublished } from "../scripts/contract.mjs";
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
