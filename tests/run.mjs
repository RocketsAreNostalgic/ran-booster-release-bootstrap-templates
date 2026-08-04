import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadJson,
  profileFiles,
  root,
  templateTokens,
  validateSource,
} from "../scripts/contract.mjs";

const temporary = await mkdtemp(
  path.join(os.tmpdir(), "ran-booster-template-tests-"),
);
const identity = {
  repositoryId: "987654321",
  releaseId: "41",
  tag: "v0.1.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
};

try {
  const schema = await loadJson(
    path.join(root, "schema/template-pack.schema.json"),
  );
  assert.equal(schema.properties.consumer_api.const, 1);
  assert.equal(schema.additionalProperties, false);

  const source = await loadJson(
    path.join(root, "src/template-pack.source.json"),
  );
  const profileDocuments = await Promise.all(
    profileFiles.map((file) => loadJson(path.join(root, file))),
  );
  const profiles = Object.fromEntries(
    profileDocuments.map(({ id, profile_version, entries }) => [
      id,
      { profile_version, entries },
    ]),
  );
  validateSource(source, profiles);
  await renderFixtures(profiles);
  await assertDeterministicPack();
  await assertTamperFails();
  process.stdout.write("All Consumer API 1 template-pack tests passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function renderFixtures(profiles) {
  const baseValues = await loadJson(
    path.join(root, "tests/fixtures/render-values.json"),
  );
  for (const [profileId, profile] of Object.entries(profiles)) {
    const fixtureRoot = path.join(temporary, profileId.replaceAll("/", "-"));
    await mkdir(fixtureRoot, { recursive: true });
    const values = {
      ...baseValues,
      EXTRA_FILES_JSON: profileId.includes("theme")
        ? '[{"type":"generic","path":"style.css"}]'
        : baseValues.EXTRA_FILES_JSON,
      HEADER_PATH: profileId.includes("theme")
        ? "style.css"
        : "example-package.php",
      PACKAGE_TYPE: profileId.includes("theme") ? "theme" : "plugin",
    };

    for (const [logicalId, entry] of Object.entries(profile.entries)) {
      const template = await readFile(path.join(root, entry.path), "utf8");
      let rendered = template;
      for (const token of [...new Set(templateTokens(template))]) {
        assert.ok(
          Object.hasOwn(values, token),
          `Fixture has no value for ${token}`,
        );
        rendered = rendered.split(`{{RAN_${token}}}`).join(values[token]);
      }
      assert.deepEqual(
        templateTokens(rendered),
        [],
        `Unrendered placeholder in ${logicalId}`,
      );
      const destination = path.join(fixtureRoot, fixtureName(logicalId));
      await writeFile(destination, rendered, "utf8");
      if (destination.endsWith(".json")) {
        const config = JSON.parse(rendered);
        assert.deepEqual(Object.keys(config.packages["."]["extra-files"][0]), [
          "type",
          "path",
        ]);
        assert.equal(config.packages["."]["prerelease"], undefined);
      }
      if (destination.endsWith(".sh"))
        execFileSync("bash", ["-n", destination], { stdio: "pipe" });
      if (destination.endsWith(".yml")) validateManagedWorkflow(rendered);
    }
  }
}

function fixtureName(logicalId) {
  if (logicalId === "release-workflow") return "release-please.yml";
  if (logicalId === "release-please-config")
    return "release-please-config.json";
  if (logicalId === "build-release-script") return "build-release.sh";
  if (logicalId === "verify-release-script") return "verify-release.sh";
  if (logicalId === "upload-release-assets-script")
    return "upload-release-assets.sh";
  throw new Error(`Unknown fixture logical ID: ${logicalId}`);
}

function validateManagedWorkflow(workflow) {
  assert.match(workflow, /^on:\n  push:\n    branches:/m);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(
    workflow,
    /git cat-file -e 'HEAD\^:\.release-please-manifest\.json'/,
  );
  assert.match(workflow, /\.immutable == true/);
  assert.match(workflow, /\.ran-booster-release-dist/);
  assert.doesNotMatch(workflow, /rm -rf build/);
  assert.doesNotMatch(workflow, /uses: [^\n]+@(main|master|v\d+)\s*$/m);
}

async function assertDeterministicPack() {
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  await mkdir(first);
  await mkdir(second);
  const arguments_ = [
    identity.repositoryId,
    identity.releaseId,
    identity.tag,
    identity.commit,
  ];
  execFileSync(
    "bash",
    [path.join(root, "scripts/build-pack.sh"), first, ...arguments_],
    { cwd: root, stdio: "pipe" },
  );
  execFileSync(
    "bash",
    [path.join(root, "scripts/build-pack.sh"), second, ...arguments_],
    { cwd: root, stdio: "pipe" },
  );
  const archiveName = "ran-booster-release-bootstrap-templates.zip";
  const one = await readFile(path.join(first, archiveName));
  const two = await readFile(path.join(second, archiveName));
  assert.ok(
    one.equals(two),
    "Pack builds are not byte-for-byte deterministic.",
  );
  execFileSync(
    "bash",
    [
      path.join(root, "scripts/verify-pack.sh"),
      path.join(first, archiveName),
      ...arguments_,
    ],
    { cwd: root, stdio: "pipe" },
  );

  const members = execFileSync(
    "unzip",
    ["-Z1", path.join(first, archiveName)],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.equal(members.includes("template-pack.json"), true);
  assert.equal(
    members.some((member) => member.endsWith("/")),
    false,
  );
  assert.equal(members.includes("release-contents.txt"), false);
}

async function assertTamperFails() {
  const extracted = path.join(temporary, "tampered");
  const archive = path.join(
    temporary,
    "first/ran-booster-release-bootstrap-templates.zip",
  );
  await mkdir(extracted);
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  const target = path.join(
    extracted,
    "templates/shared/upload-release-assets.sh.tmpl",
  );
  await writeFile(
    target,
    `${await readFile(target, "utf8")}# tampered\n`,
    "utf8",
  );
  const result = spawnSync(
    "node",
    [path.join(root, "scripts/validate-pack.mjs"), extracted],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.notEqual(
    result.status,
    0,
    "A modified template passed digest verification.",
  );
  assert.match(result.stderr, /digest mismatch|size mismatch/i);
}
