import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { assert, exactKeys, parseJson, repositoryName, stableVersion } from "./contract.mjs";

export function validateAdvisoryIndex(bytes) {
  const index = parseJson(bytes, 65536);
  exactKeys(index, ["schema", "schema_version", "advisories"], "advisory index");
  assert(index.schema === "ran-release-starter-advisories" && index.schema_version === 1, "Unknown advisory index schema.");
  assert(Array.isArray(index.advisories) && index.advisories.length <= 64, "Advisory entry budget exceeded.");
  const ids = new Set();
  const version = (v) => stableVersion(v) && v.length <= 63;
  const commit = (v) => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
  for (const advisory of index.advisories) {
    exactKeys(advisory, ["ghsa_id", "repository", "affected", "fixed"], "advisory");
    assert(typeof advisory.ghsa_id === "string" && /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/.test(advisory.ghsa_id), "Invalid GHSA identity.");
    assert(!ids.has(advisory.ghsa_id), "Duplicate GHSA identity.");
    ids.add(advisory.ghsa_id);
    assert([repositoryName, "RocketsAreNostalgic/.github"].includes(advisory.repository), "Noncanonical advisory repository.");
    exactKeys(advisory.affected, ["pack_versions", "shared_profile_b_commits"], "affected identities");
    exactKeys(advisory.fixed, ["pack_version", "shared_profile_b_commit"], "fixed identities");
    const pack = advisory.repository === repositoryName;
    const values = pack ? advisory.affected.pack_versions : advisory.affected.shared_profile_b_commits;
    const unused = pack ? advisory.affected.shared_profile_b_commits : advisory.affected.pack_versions;
    const fixed = pack ? advisory.fixed.pack_version : advisory.fixed.shared_profile_b_commit;
    const unusedFixed = pack ? advisory.fixed.shared_profile_b_commit : advisory.fixed.pack_version;
    const valid = pack ? version : commit;
    assert(Array.isArray(values) && values.length > 0 && values.every(valid) && new Set(values).size === values.length, "Invalid or duplicate affected identity.");
    assert(Array.isArray(unused) && unused.length === 0 && unusedFixed === null && valid(fixed) && !values.includes(fixed), "Invalid fixed identity or component mismatch.");
  }
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateAdvisoryIndex(await readFile(process.argv[2] ?? new URL("../security/release-starter-advisories.json", import.meta.url)));
  console.log("Advisory maintenance index is structurally valid; published GHSA cross-check remains consumer/maintainer responsibility.");
}
