import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/quality.yml", import.meta.url),
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

test("required repository lanes execute the exact reviewed source", () => {
  const packInputs = job("pack-inputs", "test");
  const repositoryTests = job("test", "quality");
  const exactRef =
    "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
  const exactExpected =
    "RAN_EXPECTED_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";

  assert.match(packInputs, /name: Pack inputs/);
  assert.match(repositoryTests, /name: Quality/);
  for (const lane of [packInputs, repositoryTests]) {
    assert.ok(lane.includes("persist-credentials: false"));
    assert.ok(lane.includes(exactRef));
    assert.ok(lane.includes(exactExpected));
    assert.ok(lane.includes('test "$(git rev-parse HEAD)" = "$RAN_EXPECTED_SHA"'));
    assert.ok(lane.includes('node-version: "24.11.0"'));
  }

  assert.ok(
    packInputs.includes(
      "RAN_SOURCE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
    ),
  );
  assert.ok(packInputs.includes('candidate_commit="$RAN_SOURCE_SHA"'));
  assert.ok(packInputs.includes('--arg quality_commit "$candidate_commit"'));
});

test("local npm quality remains dependency-free and terminal evidence fails closed", () => {
  assert.doesNotMatch(workflow, /\bnpm (?:ci|install)\b/);

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
