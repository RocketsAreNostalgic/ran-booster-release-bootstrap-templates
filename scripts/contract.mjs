import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryName =
  "RocketsAreNostalgic/ran-booster-release-bootstrap-templates";

export const profileFiles = [
  "profiles/source-ready-wordpress-plugin-2.json",
  "profiles/source-ready-wordpress-theme-2.json",
];

export const logicalIds = [
  "release-workflow",
  "release-please-config",
  "build-release-script",
  "verify-release-script",
  "upload-release-assets-script",
];

const expectedPlaceholders = {
  "release-workflow": {
    DEFAULT_BRANCH: "branch",
    PACKAGE_SLUG: "slug",
  },
  "release-please-config": {
    BASE_SHA: "sha",
    EXTRA_FILES_JSON: "json_fragment",
    PACKAGE_SLUG: "slug",
  },
  "build-release-script": {
    HEADER_PATH: "path",
    PACKAGE_SLUG: "slug",
    PACKAGE_TYPE: "package_type",
  },
  "verify-release-script": {
    HEADER_PATH: "path",
    PACKAGE_SLUG: "slug",
    PACKAGE_TYPE: "package_type",
    UPDATE_URI: "github_uri",
  },
  "upload-release-assets-script": {},
};

const forbiddenManifestKeys = new Set([
  "destination",
  "mode",
  "mutation",
  "operation",
  "ownership",
  "permissions",
  "target",
  "target_path",
  "triggers",
  "workflow_events",
]);

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function exactKeys(value, expected, label) {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object.`,
  );
  assert(
    JSON.stringify(Object.keys(value)) === JSON.stringify(expected),
    `${label} has unsupported fields or field order.`,
  );
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function templateTokens(text) {
  return [...text.matchAll(/\{\{RAN_([A-Z][A-Z0-9_]*)\}\}/g)].map(
    (match) => match[1],
  );
}

export function validateSource(source, profiles) {
  exactKeys(
    source,
    ["schema_version", "consumer_api", "profiles"],
    "source manifest",
  );
  assert(
    source.schema_version === 1 && source.consumer_api === 2,
    "Only Consumer API 2 is supported.",
  );
  assert(
    JSON.stringify(source.profiles) === JSON.stringify(profileFiles),
    "Source profile set changed.",
  );
  validateProfiles(profiles, false);
}

export function validatePublished(manifest) {
  exactKeys(
    manifest,
    [
      "schema_version",
      "consumer_api",
      "pack_version",
      "repository",
      "release",
      "profiles",
    ],
    "manifest",
  );
  assert(
    manifest.schema_version === 1 && manifest.consumer_api === 2,
    "Only Consumer API 2 is supported.",
  );
  assert(
    stableVersion(manifest.pack_version),
    "Pack version must be stable SemVer.",
  );
  exactKeys(manifest.repository, ["name", "id"], "repository identity");
  assert(
    manifest.repository.name === repositoryName,
    "Repository name is not canonical.",
  );
  assert(
    typeof manifest.repository.id === "string" &&
      /^[1-9][0-9]*$/.test(manifest.repository.id),
    "Repository ID is invalid.",
  );
  exactKeys(manifest.release, ["id", "tag", "commit"], "release identity");
  assert(
    Number.isSafeInteger(manifest.release.id) && manifest.release.id > 0,
    "Release ID is invalid.",
  );
  assert(
    manifest.release.tag === `v${manifest.pack_version}`,
    "Release tag and pack version differ.",
  );
  assert(
    /^[0-9a-f]{40}$/.test(manifest.release.commit),
    "Release commit is invalid.",
  );
  walkKeys(manifest);
  validateProfiles(manifest.profiles, true);
}

export function validateProfiles(profiles, published) {
  const expectedIds = [
    "source-ready-wordpress-plugin/2",
    "source-ready-wordpress-theme/2",
  ];
  exactKeys(profiles, expectedIds, "profiles");
  for (const profileId of expectedIds) {
    const profile = profiles[profileId];
    exactKeys(profile, ["profile_version", "entries"], `profile ${profileId}`);
    assert(
      profile.profile_version === 1,
      `Profile version changed: ${profileId}`,
    );
    exactKeys(profile.entries, logicalIds, `profile entries ${profileId}`);
    for (const logicalId of logicalIds) {
      const entry = profile.entries[logicalId];
      exactKeys(
        entry,
        published
          ? ["path", "size", "sha256", "placeholders"]
          : ["path", "placeholders"],
        logicalId,
      );
      assert(
        validMemberPath(entry.path),
        `Unsafe pack member path: ${entry.path}`,
      );
      assert(
        JSON.stringify(entry.placeholders) ===
          JSON.stringify(expectedPlaceholders[logicalId]),
        `Placeholder contract changed: ${logicalId}`,
      );
      if (published) {
        assert(
          Number.isSafeInteger(entry.size) &&
            entry.size > 0 &&
            entry.size <= 262144,
          `Invalid entry size: ${logicalId}`,
        );
        assert(
          /^[0-9a-f]{64}$/.test(entry.sha256),
          `Invalid entry digest: ${logicalId}`,
        );
      }
    }
  }
}

function walkKeys(value) {
  if (Array.isArray(value)) {
    value.forEach(walkKeys);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !forbiddenManifestKeys.has(key),
      `Manifest capability field is forbidden: ${key}`,
    );
    walkKeys(child);
  }
}

export function stableVersion(version) {
  return (
    typeof version === "string" &&
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(version)
  );
}

export function validMemberPath(member) {
  return (
    typeof member === "string" &&
    member.length <= 255 &&
    /^templates\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(member) &&
    !member.includes("..") &&
    !member.endsWith("/")
  );
}

export async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function readRegularFile(file, label) {
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink(),
    `${label} must be a regular file.`,
  );
  assert(
    metadata.size > 0 && metadata.size <= 262144,
    `${label} has an invalid size.`,
  );
  return readFile(file);
}
