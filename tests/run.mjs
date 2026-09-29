import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
const { version } = await loadJson(path.join(root, "package.json"));
const identity = {
  repositoryId: "987654321",
  tag: `v${version}`,
};
const testCrcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

try {
  const schema = await loadJson(
    path.join(root, "schema/template-pack.schema.json"),
  );
  assert.equal(schema.properties.consumer_api.const, 3);
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
  process.stdout.write("All Consumer API 3 template-pack tests passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function git(directory, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
    await assertRenderedCommitArchive(fixtureRoot, values);
  }
}

async function assertRenderedCommitArchive(renderedRoot, values) {
  const fixture = path.join(
    temporary,
    `rendered-commit-${values.PACKAGE_TYPE}`,
  );
  const scripts = path.join(fixture, "scripts");
  const source = path.join(fixture, "src");
  const assets = path.join(fixture, "assets");
  const cleanOutput = path.join(fixture, "clean-output");
  const dirtyOutput = path.join(fixture, "dirty-output");
  const changedOutput = path.join(fixture, "changed-output");
  const releaseVersion = "1.2.3";
  await mkdir(scripts, { recursive: true });
  await mkdir(source, { recursive: true });
  await mkdir(assets, { recursive: true });
  await cp(
    path.join(renderedRoot, "build-release.sh"),
    path.join(scripts, "build-release.sh"),
  );
  await cp(
    path.join(renderedRoot, "verify-release.sh"),
    path.join(scripts, "verify-release.sh"),
  );
  await chmod(path.join(scripts, "build-release.sh"), 0o755);
  await chmod(path.join(scripts, "verify-release.sh"), 0o755);
  await writeFile(
    path.join(fixture, ".release-please-manifest.json"),
    `${JSON.stringify({ ".": releaseVersion })}\n`,
  );
  await writeFile(path.join(fixture, "version.txt"), `${releaseVersion}\n`);
  await writeFile(
    path.join(fixture, "release-contents.txt"),
    ["src/Runtime.php", "assets/repeated.txt", values.HEADER_PATH, "README.md", ...(values.PACKAGE_TYPE === "theme" ? ["index.php"] : [])].sort().join("\n") + "\n",
  );
  await writeFile(path.join(fixture, "README.md"), "Fixture package.\n");
  await writeFile(path.join(assets, "repeated.txt"), "A".repeat(100000));
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// committed runtime\n",
  );
  if (values.PACKAGE_TYPE === "theme") await writeFile(path.join(fixture, "index.php"), "<?php // Fixture theme entry point.\n");
  const header =
    values.PACKAGE_TYPE === "plugin"
      ? `<?php\n/**\n * Plugin Name: Fixture package\n * Version: ${releaseVersion}\n * Update URI: ${values.UPDATE_URI}\n * Requires PHP: 8.0\n * Requires at least: 6.0\n */\n`
      : `/*\nTheme Name: Fixture package\nVersion: ${releaseVersion}\nUpdate URI: ${values.UPDATE_URI}\nRequires PHP: 8.0\nRequires at least: 6.0\n*/\n`;
  await writeFile(path.join(fixture, values.HEADER_PATH), header);

  git(fixture, "init", "-b", "main");
  git(fixture, "config", "user.email", "fixture@example.test");
  git(fixture, "config", "user.name", "Fixture");
  git(fixture, "add", ".");
  git(fixture, "commit", "-m", "chore: exact source fixture");
  const commit = git(fixture, "rev-parse", "HEAD");
  const build = path.join(scripts, "build-release.sh");
  const verify = path.join(scripts, "verify-release.sh");

  runBashWithUmask(
    build,
    [commit, releaseVersion, cleanOutput],
    fixture,
    "022",
  );
  const archiveName = `${values.PACKAGE_SLUG}-${releaseVersion}.zip`;
  const cleanArchive = path.join(cleanOutput, archiveName);
  const cleanBytes = await readFile(cleanArchive);
  assert.match(execFileSync("unzip", ["-lv", cleanArchive], { encoding: "utf8" }), /100000\s+Stored\s+100000\s+0%[^\n]*assets\/repeated\.txt/, "Highly compressible runtime member must be stored.");
  if (values.PACKAGE_TYPE === "plugin") {
    await assertHostileArchiveMatrix({
      label: "rendered release",
      cleanArchive,
      archiveBytes: 50 * 1024 * 1024,
      members: 10000,
      memberBytes: 127826407,
      totalBytes: 127826407,
      runVerify: (candidate, environment) =>
        spawnSync("bash", [verify, candidate, releaseVersion, commit], {
          cwd: fixture,
          encoding: "utf8",
          env: { ...process.env, ...environment },
        }),
    });
  }

  const qualityText = await readFile(path.join(renderedRoot, "quality.yml"), "utf8");
  const qualityBlock = qualityText.split("      - name: Build and check the exact installable package")[1]
    .split("        run: |\n")[1].split("\n      - uses:")[0]
    .split("\n").map(line => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const runQuality = (sha) => spawnSync("bash", ["-c", qualityBlock], {
    cwd: fixture, encoding: "utf8", env: { ...process.env, SOURCE_SHA: sha, GITHUB_REPOSITORY: "example/example-package" },
  });
  const qualityResult = runQuality(commit);
  assert.equal(qualityResult.status, 0, qualityResult.stderr);
  git(fixture, "restore", ".");
  await writeFile(path.join(fixture, values.HEADER_PATH), header.replace("Requires PHP: 8.0", "Requires PHP: 8.1"));
  git(fixture, "add", values.HEADER_PATH);
  git(fixture, "commit", "-m", "test: advertised minimum PHP differs from Quality");
  const mismatchedQuality = runQuality(git(fixture, "rev-parse", "HEAD"));
  assert.notEqual(mismatchedQuality.status, 0);
  assert.match(mismatchedQuality.stdout + mismatchedQuality.stderr, /Requires PHP does not match/);
  git(fixture, "reset", "--hard", commit);
  const promotion = await loadJson(path.join(fixture, ".ran-booster-release-dist/ran-profile-b-promotion.json"));
  assert.equal(promotion.source_commit, commit);
  assert.equal(promotion.quality_commit, commit);
  assert.equal(promotion.assets[0].sha256, createHash("sha256").update(cleanBytes).digest("hex"));
  await rm(path.join(fixture, ".ran-booster-release-dist"), { recursive: true });
  await writeFile(path.join(source, "Runtime.php"), "<?php this is not valid PHP;\n");
  git(fixture, "add", "src/Runtime.php");
  git(fixture, "commit", "-m", "test: invalid payload syntax");
  const syntaxFailure = runQuality(git(fixture, "rev-parse", "HEAD"));
  assert.notEqual(syntaxFailure.status, 0);
  assert.match(syntaxFailure.stdout + syntaxFailure.stderr, /Parse error|syntax error/);
  assert.match(syntaxFailure.stdout + syntaxFailure.stderr, /Read-only package qualification failed/);
  git(fixture, "reset", "--hard", commit);

  await writeFile(path.join(fixture, "release-contents.txt"), "../unsafe\n");
  await writeFile(
    path.join(fixture, values.HEADER_PATH),
    header.replace(releaseVersion, "9.9.9"),
  );
  await writeFile(path.join(fixture, "version.txt"), "9.9.9\n");
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// dirty runtime\n",
  );
  await writeFile(path.join(source, "untracked.php"), "<?php\n// untracked\n");
  runBashWithUmask(
    build,
    [commit, releaseVersion, dirtyOutput],
    fixture,
    "077",
  );
  const dirtyArchive = path.join(dirtyOutput, archiveName);
  assert.ok(
    cleanBytes.equals(await readFile(dirtyArchive)),
    `${values.PACKAGE_TYPE} archive changed under dirty tracked or untracked files.`,
  );
  execFileSync("bash", [verify, cleanArchive, releaseVersion, commit], {
    cwd: fixture,
    stdio: "pipe",
  });
  assert.notEqual(
    spawnSync("bash", [build, "", releaseVersion, dirtyOutput], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered builder accepted an omitted release commit.",
  );

  for (const [label, content] of [
    ["lfs", "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 100\n"],
  ]) {
    git(fixture, "restore", ".");
    await writeFile(path.join(source, "Runtime.php"), content);
    git(fixture, "add", "src/Runtime.php");
    git(fixture, "commit", "-m", `test: ${label} rejection`);
    const result = spawnSync("bash", [build, git(fixture, "rev-parse", "HEAD"), releaseVersion, path.join(fixture, label)], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /LFS pointer/);
    git(fixture, "reset", "--hard", commit);
  }
  for (const [label, changedHeader, error] of [
    ["wrong-uri", header.replace(values.UPDATE_URI, values.UPDATE_URI + "-wrong"), /Update URI/],
    ["wrong-php", header.replace("Requires PHP: 8.0", "Requires PHP: 9.0"), /Requires PHP/],
    ["wrong-wp", header.replace("Requires at least: 6.0", "Requires at least: invalid"), /Requires at least/],
    ["wrong-version", header.replace(releaseVersion, "1.2.4"), /version/],
    ["version-trailing-text", header.replace(`Version: ${releaseVersion}`, `Version: ${releaseVersion} unexpected`), /version/i],
    ["php-trailing-text", header.replace("Requires PHP: 8.0", "Requires PHP: 8.0 unexpected"), /Requires PHP/],
    ["wp-trailing-text", header.replace("Requires at least: 6.0", "Requires at least: 6.0 unexpected"), /Requires at least/],
  ]) {
    git(fixture, "restore", ".");
    await writeFile(path.join(fixture, values.HEADER_PATH), changedHeader);
    git(fixture, "add", values.HEADER_PATH);
    git(fixture, "commit", "-m", `test: ${label} rejection`);
    const result = spawnSync("bash", [build, git(fixture, "rev-parse", "HEAD"), releaseVersion, path.join(fixture, label)], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, error);
    const stagedRoot = path.join(fixture, `${label}-stage`);
    const candidate = path.join(fixture, `${label}-candidate.zip`);
    await mkdir(path.join(stagedRoot, values.PACKAGE_SLUG), { recursive: true });
    await writeFile(path.join(stagedRoot, values.PACKAGE_SLUG, values.HEADER_PATH), changedHeader);
    await cp(cleanArchive, candidate);
    execFileSync("zip", ["-0", "-X", "-q", candidate, `${values.PACKAGE_SLUG}/${values.HEADER_PATH}`], { cwd: stagedRoot });
    const verification = spawnSync("bash", [verify, candidate, releaseVersion, git(fixture, "rev-parse", "HEAD")], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(verification.status, 0); assert.match(verification.stderr, error);
    await rm(stagedRoot, { recursive: true });
    await rm(candidate);
    git(fixture, "reset", "--hard", commit);
  }
  for (const [label, content] of [
    ["version-internal-space", "1 .2.3\n"],
    ["version-extra-line", "1.2.3\n\n"],
  ]) {
    git(fixture, "restore", ".");
    await writeFile(path.join(fixture, "version.txt"), content);
    git(fixture, "add", "version.txt");
    git(fixture, "commit", "-m", `test: ${label} rejection`);
    const result = spawnSync("bash", [build, git(fixture, "rev-parse", "HEAD"), releaseVersion, path.join(fixture, label)], { cwd: fixture, encoding: "utf8" });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /version\.txt/);
    git(fixture, "reset", "--hard", commit);
  }
  git(fixture, "restore", ".");
  await rm(path.join(source, "untracked.php"));
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// next committed runtime\n",
  );
  git(fixture, "add", "src/Runtime.php");
  git(fixture, "commit", "-m", "fix: change committed runtime");
  const changedCommit = git(fixture, "rev-parse", "HEAD");
  execFileSync("bash", [build, changedCommit, releaseVersion, changedOutput], {
    cwd: fixture,
    stdio: "pipe",
  });
  assert.equal(
    cleanBytes.equals(await readFile(path.join(changedOutput, archiveName))),
    false,
    `${values.PACKAGE_TYPE} archive ignored changed committed bytes.`,
  );
  assert.notEqual(
    spawnSync("bash", [verify, cleanArchive, releaseVersion, changedCommit], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered verifier accepted an archive from a different commit.",
  );

  if (values.PACKAGE_TYPE === "theme") {
    git(fixture, "restore", ".");
    await rm(path.join(fixture, "index.php"));
    await mkdir(path.join(fixture, "templates"), { recursive: true });
    await writeFile(path.join(fixture, "templates/index.html"), "<!-- wp:post-content /-->\n");
    await writeFile(path.join(fixture, "theme.json"), "{}\n");
    await writeFile(path.join(fixture, "release-contents.txt"), ["README.md", "assets/repeated.txt", "src/Runtime.php", "style.css", "templates/index.html", "theme.json"].sort().join("\n") + "\n");
    git(fixture, "add", "-A");
    git(fixture, "commit", "-m", "test: block theme runtime layout");
    const blockCommit = git(fixture, "rev-parse", "HEAD");
    const blockOutput = path.join(fixture, "block-output");
    execFileSync("bash", [build, blockCommit, releaseVersion, blockOutput], { cwd: fixture, stdio: "pipe" });
    const blockArchive = path.join(blockOutput, archiveName);
    execFileSync("bash", [verify, blockArchive, releaseVersion, blockCommit], { cwd: fixture, stdio: "pipe" });
    const blockMembers = execFileSync("unzip", ["-Z1", blockArchive], { encoding: "utf8" });
    assert.match(blockMembers, /templates\/index\.html/);
    assert.doesNotMatch(blockMembers, /\/index\.php/);
    await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
      label: "incomplete block theme index",
      allowlist: ["README.md", "src/Runtime.php", "style.css", "theme.json"].join("\n") + "\n",
      error: /theme requires/,
    });
    git(fixture, "reset", "--hard", changedCommit);
    await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
      label: "missing theme index",
      allowlist: ["README.md", "src/Runtime.php", "style.css"].join("\n") + "\n",
      error: /theme requires/,
    });
  }
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "missing allowlist entry",
    allowlist: "missing-file.php\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "unsafe allowlist entry",
    allowlist: "../unsafe\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "duplicate allowlist entry",
    allowlist: "README.md\nREADME.md\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "unsorted allowlist",
    allowlist: "src/Runtime.php\nREADME.md\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "directory expansion",
    allowlist: "src\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "overlapping projection",
    allowlist: "src/\nsrc/Runtime.php\n",
  });
  const symlink = path.join(fixture, "linked-runtime.php");
  await writeFile(path.join(fixture, "link-target.php"), "<?php\n");
  execFileSync("ln", ["-s", "link-target.php", symlink]);
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "symbolic source",
    allowlist: "linked-runtime.php\n",
    add: ["linked-runtime.php", "link-target.php"],
  });

  git(fixture, "rm", "-f", "linked-runtime.php", "link-target.php");
  git(fixture, "commit", "-m", "test: remove symbolic source fixture");
  const gitlinkTarget = git(fixture, "rev-parse", "HEAD");
  git(
    fixture,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${gitlinkTarget},linked-module`,
  );
  await writeFile(
    path.join(fixture, "release-contents.txt"),
    "linked-module\n",
  );
  git(fixture, "add", "release-contents.txt");
  git(fixture, "commit", "-m", "test: committed gitlink fixture");
  const gitlinkCommit = git(fixture, "rev-parse", "HEAD");
  assert.notEqual(
    spawnSync("bash", [build, gitlinkCommit, releaseVersion, changedOutput], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered builder accepted a committed gitlink.",
  );
}

async function assertRejectedCommittedProjection(
  fixture,
  build,
  releaseVersion,
  { label, allowlist, add = [], error },
) {
  await writeFile(path.join(fixture, "release-contents.txt"), allowlist);
  git(fixture, "add", "release-contents.txt", ...add);
  git(fixture, "commit", "-m", `test: ${label}`);
  const commit = git(fixture, "rev-parse", "HEAD");
  const result = spawnSync(
    "bash",
    [build, commit, releaseVersion, path.join(fixture, `rejected-${commit}`)],
    { cwd: fixture, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0, `Rendered builder accepted ${label}.`);
  if (error) assert.match(result.stderr, error);
}

function fixtureName(logicalId) {
  if (logicalId === "quality-workflow") return "quality.yml";
  if (logicalId === "release-workflow") return "release-please.yml";
  if (logicalId === "release-please-config")
    return "release-please-config.json";
  if (logicalId === "build-release-script") return "build-release.sh";
  if (logicalId === "verify-release-script") return "verify-release.sh";
  throw new Error(`Unknown fixture logical ID: ${logicalId}`);
}

function validateManagedWorkflow(workflow) {
  for (const action of workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm))
    assert.match(action[1], /^[^@]+@[0-9a-f]{40}$/);
  assert.doesNotMatch(workflow, /secrets: inherit|pull_request_target|upload-release-assets|setup-node/);
  if (workflow.startsWith("name: Quality")) {
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /contents: read/);
    assert.match(workflow, /ran-profile-b-promotion/);
    assert.match(workflow, /cmp /);
  } else {
    assert.match(workflow, /release-profile-b.yml@63c4a4b192bbb4cf203dab281b75a0907e85c3a9/);
    assert.doesNotMatch(workflow, /\brun:|steps:|checkout|build-release/);
  }
}

async function assertDeterministicPack() {
  const sourceFixture = path.join(temporary, "pack-source");
  await mkdir(sourceFixture);
  for (const entry of [
    "package.json",
    "profiles",
    "schema",
    "scripts",
    "src",
    "templates",
  ]) {
    await cp(path.join(root, entry), path.join(sourceFixture, entry), {
      recursive: true,
    });
  }
  git(sourceFixture, "init", "-b", "main");
  git(sourceFixture, "config", "user.email", "fixture@example.test");
  git(sourceFixture, "config", "user.name", "Fixture");
  git(sourceFixture, "add", ".");
  git(sourceFixture, "commit", "-m", "chore: exact pack source");
  const commit = git(sourceFixture, "rev-parse", "HEAD");
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  await mkdir(first);
  await mkdir(second);
  const arguments_ = [
    identity.repositoryId,
    identity.tag,
    commit,
  ];
  runBashWithUmask(
    path.join(sourceFixture, "scripts/build-pack.sh"),
    [first, ...arguments_],
    sourceFixture,
    "022",
  );
  const commandOutput = path.join(temporary, "documented-pnpm-command");
  execFileSync("pnpm", ["run", "build", "--", commandOutput, ...arguments_], { cwd: sourceFixture, stdio: "pipe" });
  await writeFile(
    path.join(sourceFixture, "package.json"),
    `${JSON.stringify({ name: "dirty", version: "9.9.9" })}\n`,
  );
  await writeFile(
    path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
    "dirty template\n",
  );
  await writeFile(
    path.join(sourceFixture, "src/template-pack.source.json"),
    "{}\n",
  );
  await writeFile(
    path.join(sourceFixture, "profiles/source-ready-wordpress-plugin-3.json"),
    "{}\n",
  );
  await writeFile(
    path.join(sourceFixture, "templates/shared/untracked-looking.tmpl"),
    "untracked template\n",
  );
  runBashWithUmask(
    path.join(sourceFixture, "scripts/build-pack.sh"),
    [second, ...arguments_],
    sourceFixture,
    "077",
  );
  const archiveName = "ran-booster-release-bootstrap-templates.zip";
  const one = await readFile(path.join(first, archiveName));
  const two = await readFile(path.join(second, archiveName));
  assert.ok(one.equals(await readFile(path.join(commandOutput, archiveName))), "Documented pnpm build interface changed the bytes.");
  assert.ok(
    one.equals(two),
    "Pack builds are not byte-for-byte deterministic.",
  );
  await assertHostileArchiveMatrix({
    label: "template pack",
    cleanArchive: path.join(first, archiveName),
    archiveBytes: 2 * 1024 * 1024,
    members: 32,
    memberBytes: 256 * 1024,
    totalBytes: 1024 * 1024,
    runVerify: (candidate, environment) =>
      spawnSync(
        "bash",
        [
          path.join(sourceFixture, "scripts/verify-pack.sh"),
          candidate,
          ...arguments_,
        ],
        {
          cwd: sourceFixture,
          encoding: "utf8",
          env: { ...process.env, ...environment },
        },
      ),
  });
  execFileSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/verify-pack.sh"),
      path.join(first, archiveName),
      ...arguments_,
    ],
    { cwd: sourceFixture, stdio: "pipe" },
  );
  const missing = spawnSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/build-pack.sh"),
      path.join(temporary, "missing-pack"),
      identity.repositoryId,
        identity.tag,
      "f".repeat(40),
    ],
    { cwd: sourceFixture, encoding: "utf8" },
  );
  assert.notEqual(
    missing.status,
    0,
    "Pack builder accepted an unavailable commit.",
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
  assert.equal(members.length, 6);
  assert.equal(members.some(member => member.includes("advisories")), false);
  const evidenceDir = path.join(temporary, "exchange");
  execFileSync(process.execPath, [path.join(root, "scripts/pack-evidence.mjs"), path.join(first, archiveName), evidenceDir]);
  const envelope = await loadJson(path.join(evidenceDir, "producer-exchange.json"));
  assert.equal(envelope.producer_sha, commit);
  assert.equal(envelope.zip_sha256, createHash("sha256").update(one).digest("hex"));
  assert.equal(Object.keys(envelope.profiles).length, 2);
  for (const profile of Object.values(envelope.profiles)) assert.equal(Object.keys(profile).length, 5);

  git(sourceFixture, "restore", ".");
  await rm(path.join(sourceFixture, "templates/shared/untracked-looking.tmpl"));
  await writeFile(
    path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
    `${await readFile(
      path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
      "utf8",
    )}\n# next committed template bytes\n`,
  );
  git(sourceFixture, "add", "templates/shared/build-release.sh.tmpl");
  git(sourceFixture, "commit", "-m", "fix: change committed pack input");
  const changedCommit = git(sourceFixture, "rev-parse", "HEAD");
  const changedArguments = [
    identity.repositoryId,
    identity.tag,
    changedCommit,
  ];
  const changedOutput = path.join(temporary, "changed-pack");
  execFileSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/build-pack.sh"),
      changedOutput,
      ...changedArguments,
    ],
    { cwd: sourceFixture, stdio: "pipe" },
  );
  assert.equal(
    one.equals(await readFile(path.join(changedOutput, archiveName))),
    false,
    "Pack archive ignored changed committed template bytes.",
  );
  assert.notEqual(
    spawnSync(
      "bash",
      [
        path.join(sourceFixture, "scripts/verify-pack.sh"),
        path.join(first, archiveName),
        ...changedArguments,
      ],
      { cwd: sourceFixture, encoding: "utf8" },
    ).status,
    0,
    "Pack verifier accepted an archive from a different commit.",
  );

  await rm(path.join(sourceFixture, "scripts/contract.mjs"));
  await mkdir(path.join(sourceFixture, "scripts/contract.mjs"));
  await writeFile(
    path.join(sourceFixture, "scripts/contract.mjs/nested.mjs"),
    "export default {};\n",
  );
  git(sourceFixture, "add", "-A");
  git(sourceFixture, "commit", "-m", "test: required pack input as tree");
  const nonBlobCommit = git(sourceFixture, "rev-parse", "HEAD");
  assert.notEqual(
    spawnSync(
      "bash",
      [
        path.join(sourceFixture, "scripts/build-pack.sh"),
        path.join(temporary, "non-blob-pack"),
        identity.repositoryId,
            identity.tag,
        nonBlobCommit,
      ],
      { cwd: sourceFixture, encoding: "utf8" },
    ).status,
    0,
    "Pack builder accepted a required control path as a tree.",
  );
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
    "templates/shared/build-release.sh.tmpl",
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

function runBashWithUmask(script, arguments_, cwd, mask) {
  execFileSync(
    "bash",
    [
      "-c",
      'umask "$1"; shift; exec "$@"',
      "exact-commit-fixture",
      mask,
      "bash",
      script,
      ...arguments_,
    ],
    { cwd, stdio: "pipe" },
  );
}

async function assertHostileArchiveMatrix({
  label,
  cleanArchive,
  archiveBytes,
  members,
  memberBytes,
  totalBytes,
  runVerify,
}) {
  const fixture = path.join(temporary, `hostile-${label.replaceAll(" ", "-")}`);
  const bin = path.join(fixture, "bin");
  const marker = path.join(fixture, "unzip-called");
  await mkdir(bin, { recursive: true });
  const fakeUnzip = path.join(bin, "unzip");
  await writeFile(
    fakeUnzip,
    '#!/usr/bin/env bash\nprintf "called\\n" > "$RAN_UNZIP_MARKER"\nexit 97\n',
  );
  await chmod(fakeUnzip, 0o755);
  const environment = {
    PATH: `${bin}:${process.env.PATH}`,
    RAN_UNZIP_MARKER: marker,
  };
  const sourceEntries = archiveEntries(cleanArchive);
  const firstFile = sourceEntries.find((entry) => !entry.name.endsWith("/"));
  assert.ok(firstFile, `${label} has no regular fixture member.`);
  const unsafe = "unsafe/member.php";
  const budgetCompressed = (size) => Math.max(1, Math.ceil(size / 199));
  const totalEntryCount = Math.floor(totalBytes / memberBytes) + 2;
  const totalEntrySize = Math.floor(totalBytes / (totalEntryCount - 1)) + 1;
  const hostileCases = [
    ["duplicate raw member", "duplicate_member", [firstFile, firstFile]],
    [
      "case-normalized collision",
      "normalized_collision",
      [firstFile, { ...firstFile, name: firstFile.name.toUpperCase() }],
    ],
    [
      "file-directory collision",
      "normalized_collision",
      [firstFile, archiveMember(`${firstFile.name}/`, "", 0o040755)],
    ],
    [
      "file-parent hierarchy",
      "member_hierarchy",
      [archiveMember("parent"), archiveMember("parent/child.php")],
    ],
    ["absolute path", "member_path", [archiveMember("/absolute.php")]],
    ["drive path", "member_path", [archiveMember("C:/drive.php")]],
    ["backslash path", "member_path", [archiveMember("bad\\path.php")]],
    ["traversal path", "member_path", [archiveMember("../escape.php")]],
    ["dot segment", "member_path", [archiveMember("bad/./path.php")]],
    ["empty segment", "member_path", [archiveMember("bad//path.php")]],
    ["trailing dot", "member_path", [archiveMember("bad./path.php")]],
    ["trailing space", "member_path", [archiveMember("bad /path.php")]],
    ["control character", "member_path", [archiveMember("bad\npath.php")]],
    ["reserved device", "member_path", [archiveMember("CON/file.php")]],
    ["non-ASCII path", "member_path", [archiveMember("café.php")]],
    [
      "invalid UTF-8 path",
      "name_encoding",
      [
        {
          ...archiveMember("invalid.php"),
          nameBytes: Buffer.from([0xff]),
          localNameBytes: Buffer.from([0xff]),
        },
      ],
    ],
    [
      "overlong segment",
      "member_path",
      [archiveMember(`${"a".repeat(256)}.php`)],
    ],
    [
      "symbolic link",
      "member_type",
      [archiveMember(unsafe, "target", 0o120777)],
    ],
    ["FIFO", "member_type", [archiveMember(unsafe, "", 0o010644)]],
    ["socket", "member_type", [archiveMember(unsafe, "", 0o140644)]],
    ["device", "member_type", [archiveMember(unsafe, "", 0o060644)]],
    ["executable", "member_executable", [archiveMember(unsafe, "x", 0o100755)]],
    ["non-Unix host", "member_type", [{ ...archiveMember(unsafe), host: 0 }]],
    [
      "encrypted",
      "unsupported_member",
      [{ ...archiveMember(unsafe), flags: 1 }],
    ],
    [
      "data descriptor",
      "unsupported_member",
      [{ ...archiveMember(unsafe), flags: 8 }],
    ],
    [
      "unsupported compression",
      "unsupported_member",
      [{ ...archiveMember(unsafe), method: 12 }],
    ],
    [
      "ZIP extra",
      "directory_record",
      [{ ...archiveMember(unsafe), centralExtra: Buffer.from([1, 0, 0, 0]) }],
    ],
    [
      "central comment",
      "directory_record",
      [{ ...archiveMember(unsafe), centralComment: Buffer.from("comment") }],
    ],
    [
      "local extra",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localExtra: Buffer.from([1, 0, 0, 0]) }],
    ],
    [
      "central disk start",
      "directory_record",
      [{ ...archiveMember(unsafe), diskStart: 1 }],
    ],
    [
      "ZIP64 version",
      "directory_record",
      [{ ...archiveMember(unsafe), needed: 45 }],
    ],
    [
      "ZIP64 entry count",
      "multidisk_or_zip64",
      [archiveMember(unsafe)],
      { entryCount: 0xffff },
    ],
    [
      "EOCD comment",
      "directory_missing",
      [archiveMember(unsafe)],
      { eocdComment: Buffer.from("comment") },
    ],
    [
      "trailing data",
      "directory_missing",
      [archiveMember(unsafe)],
      { trailing: Buffer.from("trailing") },
    ],
    [
      "member budget",
      "member_budget",
      [
        {
          ...archiveMember(unsafe),
          compressedSize: budgetCompressed(memberBytes + 1),
          uncompressedSize: memberBytes + 1,
        },
      ],
    ],
    [
      "ratio budget",
      "member_budget",
      [
        {
          ...archiveMember(unsafe),
          compressedSize: 1,
          uncompressedSize: 201,
        },
      ],
    ],
    [
      "total budget",
      "total_budget",
      Array.from({ length: totalEntryCount }, (_, index) => ({
        ...archiveMember(`total-${index}.php`),
        compressedSize: budgetCompressed(totalEntrySize),
        uncompressedSize: totalEntrySize,
      })),
    ],
    [
      "member-count budget",
      "directory_bounds",
      [archiveMember(unsafe)],
      { entryCount: members + 1 },
    ],
    [
      "local name mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localName: "other/member.php" }],
    ],
    [
      "local flags mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localFlags: 0x0800 }],
    ],
    [
      "local method mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localMethod: 8 }],
    ],
    [
      "local CRC mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localCrc: 1 }],
    ],
    [
      "local size mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localUncompressedSize: 2 }],
    ],
    [
      "overlapping local records",
      "local_bounds",
      [
        archiveMember("one.php"),
        { ...archiveMember("two.php"), localOffset: 0 },
      ],
    ],
    [
      "incorrect CRC",
      "member_integrity",
      [{ ...archiveMember(unsafe), crc: 1, localCrc: 1 }],
    ],
    [
      "expanded size mismatch",
      "member_integrity",
      [
        {
          ...archiveMember(unsafe),
          uncompressedSize: 2,
          localUncompressedSize: 2,
        },
      ],
    ],
    [
      "corrupt deflate stream",
      "member_decompression",
      [{ ...archiveMember(unsafe, "not-deflate"), method: 8 }],
    ],
    [
      "directory payload",
      "directory_payload",
      [archiveMember("payload/", "x", 0o040755)],
    ],
    [
      "unexpected member",
      "unexpected",
      [...sourceEntries, archiveMember("unexpected-member.txt")],
    ],
  ];

  for (const [caseName, code, entries, options = {}] of hostileCases) {
    const candidate = path.join(
      fixture,
      `${caseName.replaceAll(/[^A-Za-z0-9]+/g, "-")}.zip`,
    );
    await writeFile(candidate, makeZip(entries, options));
    await rm(marker, { force: true });
    const result = runVerify(candidate, environment);
    assert.notEqual(result.status, 0, `${label} accepted ${caseName}.`);
    if (code === "unexpected")
      assert.match(
        result.stderr,
        /unexpected member set|committed runtime allowlist/i,
      );
    else
      assert.match(
        result.stderr,
        new RegExp(code, "i"),
        `${label}: ${caseName}`,
      );
    await assert.rejects(
      readFile(marker),
      undefined,
      `${label} extracted ${caseName}.`,
    );
  }

  const oversized = path.join(fixture, "oversized.zip");
  const handle = await open(oversized, "w");
  await handle.truncate(archiveBytes + 1);
  await handle.close();
  await rm(marker, { force: true });
  const result = runVerify(oversized, environment);
  assert.notEqual(result.status, 0, `${label} accepted an oversized archive.`);
  assert.match(result.stderr, /archive_size|ZIP size is invalid/i);
  await assert.rejects(
    readFile(marker),
    undefined,
    `${label} extracted an oversized archive.`,
  );
}

function archiveEntries(archive) {
  const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  return names.map((name) =>
    archiveMember(
      name,
      name.endsWith("/")
        ? Buffer.alloc(0)
        : execFileSync("unzip", ["-p", archive, name]),
      name.endsWith("/") ? 0o040755 : 0o100644,
    ),
  );
}

function archiveMember(name, contents = "x", mode = 0o100644) {
  return {
    name,
    contents: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
    mode,
  };
}

function makeZip(entries, options = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.nameBytes ?? Buffer.from(entry.name);
    const localName =
      entry.localNameBytes ?? Buffer.from(entry.localName ?? entry.name);
    const contents = entry.contents;
    const crc = entry.crc ?? testCrc32(contents);
    const compressedSize = entry.compressedSize ?? contents.length;
    const uncompressedSize = entry.uncompressedSize ?? contents.length;
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const centralComment = entry.centralComment ?? Buffer.alloc(0);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(entry.localNeeded ?? entry.needed ?? 20, 4);
    localHeader.writeUInt16LE(entry.localFlags ?? flags, 6);
    localHeader.writeUInt16LE(entry.localMethod ?? method, 8);
    localHeader.writeUInt32LE(entry.localCrc ?? crc, 14);
    localHeader.writeUInt32LE(entry.localCompressedSize ?? compressedSize, 18);
    localHeader.writeUInt32LE(
      entry.localUncompressedSize ?? uncompressedSize,
      22,
    );
    localHeader.writeUInt16LE(localName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);
    const localRecord = Buffer.concat([
      localHeader,
      localName,
      localExtra,
      contents,
    ]);
    local.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(((entry.host ?? 3) << 8) | 20, 4);
    centralHeader.writeUInt16LE(entry.needed ?? 20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(centralComment.length, 32);
    centralHeader.writeUInt16LE(entry.diskStart ?? 0, 34);
    const dosDirectory = entry.name.endsWith("/") ? 0x10 : 0;
    centralHeader.writeUInt32LE(
      (((entry.mode << 16) >>> 0) | dosDirectory) >>> 0,
      38,
    );
    centralHeader.writeUInt32LE(entry.localOffset ?? offset, 42);
    central.push(
      Buffer.concat([centralHeader, name, centralExtra, centralComment]),
    );
    offset += localRecord.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocdComment = options.eocdComment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  const entryCount = options.entryCount ?? entries.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.disk ?? 0, 4);
  eocd.writeUInt16LE(options.centralDisk ?? 0, 6);
  eocd.writeUInt16LE(options.diskEntries ?? entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(eocdComment.length, 20);
  return Buffer.concat([
    ...local,
    centralBytes,
    eocd,
    eocdComment,
    options.trailing ?? Buffer.alloc(0),
  ]);
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = testCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
