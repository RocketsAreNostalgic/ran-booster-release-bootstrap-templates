import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Execute the shipped heredoc verbatim, without the outer Bash path checks, so
// native PHP failure boundaries are exercised directly.
const template = await readFile(
  new URL("../templates/shared/verify-release.sh.tmpl", import.meta.url),
  "utf8",
);
const matches = [
  ...template.matchAll(
    /<<'RAN_ARCHIVE_INSPECTOR'\n([\s\S]*?)\nRAN_ARCHIVE_INSPECTOR\n/g,
  ),
];
assert.equal(matches.length, 1);

test("archive inspector reports native input failures without success output", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ran-inspector-"));
  try {
    const inspector = path.join(temporary, "inspector.php");
    const archive = path.join(temporary, "archive.zip");
    await writeFile(inspector, matches[0][1]);
    function rejects(archivePath, code, options = []) {
      const env = { ...process.env };
      delete env.RAN_ARCHIVE_PATH;
      if (archivePath !== undefined) env.RAN_ARCHIVE_PATH = archivePath;
      const result = spawnSync(
        "php",
        ["-d", "display_errors=stderr", ...options, inspector],
        { env, encoding: "utf8" },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, "");
      assert.ok(
        result.stderr.endsWith(`verify-release archive: ${code}\n`),
        result.stderr,
      );
      assert.doesNotMatch(result.stderr, /TypeError|ValueError|Deprecated/);
    }
    rejects("inspector-read-failure://archive.zip", "archive_read", [
      "-d",
      `auto_prepend_file=${fileURLToPath(new URL("fixtures/inspector-read-failure.php", import.meta.url))}`,
    ]);
    rejects(undefined, "archive_path");
    rejects("", "archive_path");
    rejects(archive, "archive_size");
    await writeFile(archive, "");
    rejects(archive, "archive_size");
    await truncate(archive, 50 * 1024 * 1024 + 1);
    rejects(archive, "archive_size");
    await writeFile(archive, Buffer.from([0x50, 0x4b, 0x05]));
    rejects(archive, "directory_missing");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("archive inspector emits its failure protocol when PHP reads stdin", () => {
  const env = { ...process.env };
  delete env.RAN_ARCHIVE_PATH;
  const result = spawnSync("php", ["-d", "display_errors=stderr"], {
    env,
    input: matches[0][1],
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "verify-release archive: archive_path\n");
});
