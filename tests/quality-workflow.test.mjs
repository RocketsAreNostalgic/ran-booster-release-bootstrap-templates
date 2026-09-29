import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const quality = await read(".github/workflows/quality.yml");
const release = await read(".github/workflows/release-please.yml");
const pin = "63c4a4b192bbb4cf203dab281b75a0907e85c3a9";

test("read-only Quality qualifies and uploads final bytes on every supported event", () => {
  assert.match(quality, /^permissions: \{\}$/m);
  assert.match(quality, /workflow_dispatch:/);
  assert.doesNotMatch(quality, /contents: write|secrets:|pull_request_target|inputs\.tar/);
  assert.match(quality, /persist-credentials: false/);
  assert.match(quality, /github\.event\.pull_request\.head\.sha \|\| github\.sha/);
  assert.equal((quality.match(/bash scripts\/build-pack.sh/g) ?? []).length, 2);
  assert.match(quality, /cmp dist\/ran-booster-release-bootstrap-templates.zip/);
  assert.match(quality, /bash scripts\/verify-pack.sh/);
  assert.match(quality, /node scripts\/pack-evidence.mjs/);
  assert.match(quality, /name: ran-booster-release-bootstrap-templates-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(quality, /name: Pack inputs/);
  assert.match(quality, /name: Quality/);
  for (const gate of ['test "$BASELINE_RESULT" = success', 'test "$PACK_INPUTS_RESULT" = success', 'test "$TEST_RESULT" = success']) assert.ok(quality.includes(gate));
});

test("thin publisher promotes without privileged checkout, build or repack", async () => {
  for (const caller of [release, await read("templates/shared/release-please.yml.tmpl")]) {
    assert.ok(caller.includes(`release-profile-b.yml@${pin}`));
    assert.match(caller, /workflow_run:/);
    assert.match(caller, /expected-workflow-path: .github\/workflows\/quality.yml/);
    assert.match(caller, /actions: write/);
    assert.doesNotMatch(caller, /\brun:|steps:|checkout|secrets: inherit|upload-pack|build-pack|clobber/);
  }
  const config = JSON.parse(await read("release-please-config.json"));
  assert.equal(config.draft, true); assert.equal(config["force-tag-creation"], true);
  assert.equal(config["skip-github-release"], undefined);
});

test("declared toolchain and reviewed immutable actions remain exact", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.packageManager, "pnpm@11.13.1");
  assert.equal(pkg.volta.node, "24.11.0");
  assert.match(quality, /quality-node.yml@72a90b5826db37d1e94cdcdcf3374ccf58c0aa7d/);
  for (const workflow of [quality, release, await read("templates/shared/quality.yml.tmpl")]) {
    for (const action of workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)) assert.match(action[1], /^[^@]+@[0-9a-f]{40}$/);
  }
  for (const adapter of ["build", "verify"]) assert.doesNotMatch(await read(`templates/shared/${adapter}-release.sh.tmpl`), /\bnode\b|npm|composer|gh api/);
});
