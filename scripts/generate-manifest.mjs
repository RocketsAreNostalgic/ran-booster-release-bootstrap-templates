import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assert,
  loadJson,
  profileFiles,
  readRegularFile,
  repositoryName,
  root,
  sha256,
  stableVersion,
  templateTokens,
  validatePublished,
  validateSource,
} from "./contract.mjs";

const [
  stageArgument,
  version,
  repositoryId,
  releaseIdText,
  releaseTag,
  releaseCommit,
] = process.argv.slice(2);
assert(stageArgument, "Expected a staging directory.");
assert(stableVersion(version), "Expected a stable SemVer pack version.");
assert(
  /^[1-9][0-9]*$/.test(repositoryId ?? ""),
  "Expected a numeric repository ID.",
);
assert(
  /^[1-9][0-9]*$/.test(releaseIdText ?? ""),
  "Expected a positive release ID.",
);
assert(
  releaseTag === `v${version}`,
  "Release tag must match the pack version.",
);
assert(
  /^[0-9a-f]{40}$/.test(releaseCommit ?? ""),
  "Expected a full release commit SHA.",
);

const stage = path.resolve(stageArgument);
const source = await loadJson(path.join(root, "src/template-pack.source.json"));
const profileDocuments = await Promise.all(
  profileFiles.map((file) => loadJson(path.join(root, file))),
);
const sourceProfiles = Object.fromEntries(
  profileDocuments.map(({ id, profile_version, entries }) => [
    id,
    { profile_version, entries },
  ]),
);
validateSource(source, sourceProfiles);

const publishedProfiles = {};
for (const [profileId, profile] of Object.entries(sourceProfiles)) {
  const entries = {};
  for (const [logicalId, entry] of Object.entries(profile.entries)) {
    const sourceFile = path.join(root, entry.path);
    const bytes = await readRegularFile(
      sourceFile,
      `${profileId}:${logicalId}`,
    );
    const text = bytes.toString("utf8");
    assert(
      Buffer.from(text, "utf8").equals(bytes),
      `Template is not valid UTF-8: ${logicalId}`,
    );
    const actualTokens = [...new Set(templateTokens(text))].sort();
    const declaredTokens = Object.keys(entry.placeholders).sort();
    assert(
      JSON.stringify(actualTokens) === JSON.stringify(declaredTokens),
      `Template placeholders differ: ${logicalId}`,
    );
    entries[logicalId] = {
      path: entry.path,
      size: bytes.length,
      sha256: sha256(bytes),
      placeholders: entry.placeholders,
    };
    const destination = path.join(stage, entry.path);
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await cp(sourceFile, destination, {
        dereference: false,
        errorOnExist: true,
      });
    } catch (error) {
      if (error?.code !== "ERR_FS_CP_EEXIST" && error?.code !== "EEXIST")
        throw error;
    }
  }
  publishedProfiles[profileId] = {
    profile_version: profile.profile_version,
    entries,
  };
}

const manifest = {
  schema_version: 1,
  consumer_api: 1,
  pack_version: version,
  repository: { name: repositoryName, id: repositoryId },
  release: {
    id: Number(releaseIdText),
    tag: releaseTag,
    commit: releaseCommit,
  },
  profiles: publishedProfiles,
};
validatePublished(manifest);
await writeFile(
  path.join(stage, "template-pack.json"),
  `${JSON.stringify(manifest)}\n`,
  "utf8",
);
