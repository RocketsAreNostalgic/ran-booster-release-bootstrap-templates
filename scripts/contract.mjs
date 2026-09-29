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
  "profiles/source-ready-wordpress-plugin-3.json",
  "profiles/source-ready-wordpress-theme-3.json",
];

export const entryPaths = {
  "quality-workflow": "templates/shared/quality.yml.tmpl",
  "release-workflow": "templates/shared/release-please.yml.tmpl",
  "release-please-config": "templates/shared/release-please-config.json.tmpl",
  "build-release-script": "templates/shared/build-release.sh.tmpl",
  "verify-release-script": "templates/shared/verify-release.sh.tmpl",
};

export const logicalIds = [
  "quality-workflow",
  "release-workflow",
  "release-please-config",
  "build-release-script",
  "verify-release-script",
];

export const expectedPlaceholders = {
  "quality-workflow": {
    PACKAGE_SLUG: "slug",
    PHP_VERSION: "php_version",
  },
  "release-workflow": {
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
    source.schema_version === 1 && source.consumer_api === 3,
    "Only Consumer API 3 is supported.",
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
    manifest.schema_version === 1 && manifest.consumer_api === 3,
    "Only Consumer API 3 is supported.",
  );
  assert(
    stableVersion(manifest.pack_version) && manifest.pack_version.length <= 63,
    "Pack version must be bounded stable SemVer.",
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
  exactKeys(manifest.release, ["tag", "commit"], "release identity");
  assert(
    manifest.release.tag === `v${manifest.pack_version}`,
    "Release tag and pack version differ.",
  );
  assert(
    typeof manifest.release.commit === "string" && /^[0-9a-f]{40}$/.test(manifest.release.commit),
    "Release commit is invalid.",
  );
  walkKeys(manifest);
  validateProfiles(manifest.profiles, true);
}

export function validateProfiles(profiles, published) {
  const expectedIds = [
    "source-ready-wordpress-plugin/3",
    "source-ready-wordpress-theme/3",
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
        validMemberPath(entry.path) && entry.path === entryPaths[logicalId],
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
          typeof entry.sha256 === "string" && /^[0-9a-f]{64}$/.test(entry.sha256),
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
  return parseJson(await readFile(file));
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

// JSON.parse alone silently accepts duplicate keys. Validate structure first, then
// inspect the original tokens so escaped aliases cannot hide an ambiguous key.
export function parseJson(bytes, limit = 1048576) {
  assert(bytes.length <= limit, "JSON exceeds its byte budget.");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert(!text.includes("\0"), "JSON contains NUL.");
  const value = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "{" || token === "[") {
      stack.push(token === "{" ? new Set() : null);
      assert(stack.length <= 32, "JSON nesting exceeds budget.");
    } else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const keys = stack.at(-1);
      const key = JSON.parse(token);
      assert(keys && !keys.has(key), "JSON contains duplicate keys.");
      keys.add(key);
    }
  }
  return value;
}
