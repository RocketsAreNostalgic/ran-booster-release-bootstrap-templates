import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/quality.yml", import.meta.url),
  "utf8",
);
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const lockfile = await readFile(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);

function job(name, nextName) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `${name} job is missing`);
  const end = nextName
    ? workflow.indexOf(`\n  ${nextName}:\n`, start + 1)
    : workflow.length;
  assert.notEqual(end, -1, `${nextName} job is missing`);
  return workflow.slice(start, end);
}

test("Pack inputs stays exact-head and repository-owned", () => {
  const packInputs = job("pack-inputs", "baseline");
  const exactRef =
    "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
  const exactExpected =
    "RAN_EXPECTED_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";

  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(packInputs, /name: Pack inputs/);
  assert.match(packInputs, /permissions:\n\s+contents: read/);
  assert.ok(packInputs.includes("persist-credentials: false"));
  assert.ok(packInputs.includes(exactRef));
  assert.ok(packInputs.includes(exactExpected));
  assert.ok(
    packInputs.includes('test "$(git rev-parse HEAD)" = "$RAN_EXPECTED_SHA"'),
  );
  assert.ok(packInputs.includes('node-version: "24.11.0"'));
  assert.ok(
    packInputs.includes(
      "RAN_SOURCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
    ),
  );
  assert.ok(packInputs.includes('candidate_commit="$RAN_SOURCE_SHA"'));
  assert.ok(packInputs.includes('--arg quality_commit "$candidate_commit"'));
});

test("shared Node baseline is immutable and uses the house pnpm toolchain", () => {
  const baseline = job("baseline", "test");

  assert.match(baseline, /permissions:\n\s+contents: read/);
  assert.match(
    baseline,
    /uses: RocketsAreNostalgic\/.github\/\.github\/workflows\/quality-node\.yml@72a90b5826db37d1e94cdcdcf3374ccf58c0aa7d/,
  );
  assert.match(baseline, /node-version-file: package\.json/);
  assert.match(baseline, /pnpm-version: '11\.13\.1'/);

  assert.equal(pkg.packageManager, "pnpm@11.13.1");
  assert.equal(pkg.volta.node, "24.11.0");
  assert.equal(pkg.engines.pnpm, ">=11 <12");
  assert.equal(pkg.scripts.check, "pnpm test");
  assert.match(lockfile, /^lockfileVersion: '9\.0'$/m);
  assert.match(lockfile, /^importers:$/m);
  assert.match(lockfile, /^  \.: \{\}$/m);
});

test("required Quality alias and terminal evidence fail closed", () => {
  const qualityAlias = job("test", "quality");
  assert.match(qualityAlias, /name: Quality/);
  assert.ok(qualityAlias.includes("if: ${{ always() }}"));
  assert.match(qualityAlias, /needs:\n\s+- baseline/);
  assert.ok(
    qualityAlias.includes("BASELINE_RESULT: ${{ needs.baseline.result }}"),
  );
  assert.ok(qualityAlias.includes('test "$BASELINE_RESULT" = success'));

  const terminal = job("quality");
  assert.match(terminal, /name: quality/);
  assert.ok(terminal.includes("if: ${{ always() }}"));
  assert.match(terminal, /needs:\n\s+- pack-inputs\n\s+- test/);
  assert.ok(
    terminal.includes("PACK_INPUTS_RESULT: ${{ needs.pack-inputs.result }}"),
  );
  assert.ok(terminal.includes("TEST_RESULT: ${{ needs.test.result }}"));
  assert.ok(terminal.includes('test "$PACK_INPUTS_RESULT" = success'));
  assert.ok(terminal.includes('test "$TEST_RESULT" = success'));
});
