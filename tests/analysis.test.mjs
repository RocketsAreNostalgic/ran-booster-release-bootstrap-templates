import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractInspector, maintainedPhpFiles, verifyAnalyzer } from "../scripts/analyze-inspector.mjs";

const name = "shared/verify-release.sh.tmpl";
const original = await readFile(new URL(`../templates/${name}`, import.meta.url));
const extract = (bytes) => extractInspector(new Map([[name, bytes]]));

test("extracts the exact shipped inspector bytes, including final newline", () => {
  const text = original.toString("utf8");
  const expected = text.split("<<'RAN_ARCHIVE_INSPECTOR'\n")[1].split("RAN_ARCHIVE_INSPECTOR\n")[0];
  assert.deepEqual(extract(original), Buffer.from(expected));
});

test("missing, duplicate and malformed inspector boundaries fail", () => {
  assert.throws(() => extractInspector(new Map()), /Missing inspector/);
  assert.throws(() => extract(Buffer.concat([original, original])), /one exact/);
  assert.throws(() => extract(Buffer.from(original.toString().replace("\nRAN_ARCHIVE_INSPECTOR\n", "\nOTHER\n"))), /closing delimiter/);
  assert.throws(() => extract(Buffer.from(original.toString().replace("<?php\n", "\n"))), /start with PHP/);
});

test("additional literal PHP surfaces fail wherever templates are nested", () => {
  for (const extra of ["php -r 'echo 1;'\n", "result=$(php -r 'echo 1;')\n", "(php -r 'echo 1;')\n", "VAR=1 php -r 'echo 1;'\n", "printf x | php\n", "<?php echo 1;\n", "<?= 1 ?>\n"]) {
    assert.throws(() => extract(Buffer.concat([original, Buffer.from(extra)])), /Unexpected/);
    assert.throws(() => extractInspector(new Map([[name, original], ["nested/new.sh.tmpl", Buffer.from(extra)]])), /Unexpected/);
  }
  assert.throws(() => extractInspector(new Map([[name, original], ["nested/new.php.tmpl", Buffer.from("fixture")]])), /Unexpected PHP file/);
});

test("analysis suppression and an untrusted analyzer fail closed", () => {
  assert.throws(() => extract(Buffer.from(original.toString().replace("<?php\n", "<?php\n// @PHPSTAN-IGNORE-LINE\n"))), /suppress analysis/);
  assert.throws(() => verifyAnalyzer(Buffer.from("untrusted PHP")), /SHA-256 mismatch/);
});


test("maintained discovery covers new, nested, relocated and extensionless PHP", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ran-analysis-discovery-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    await mkdir(path.join(directory, "tests", "nested"), { recursive: true });
    await mkdir(path.join(directory, "scripts"));
    const names = ["root.php", "tests/nested/new.php", "scripts/relocated", "tests/nested/ignored.php", "bom", "short-echo", "mixed"];
    for (const name of names) await writeFile(path.join(directory, name), "<?php\nfunction example(): int { return 1; }\n");
    await writeFile(path.join(directory, ".gitignore"), "tests/nested/ignored.php\n");
    await writeFile(path.join(directory, "bom"), "\uFEFF#!/usr/bin/php\n<?php echo 1;\n");
    await writeFile(path.join(directory, "mixed"), "<p>inert HTML</p>\n<?php echo 1; ?>\n");
    await writeFile(path.join(directory, "short-echo"), "<?= 1 ?>\n");
    await writeFile(path.join(directory, "fixture.mjs"), 'const fixture = "<?php echo 1;";\n');
    execFileSync("git", ["-C", directory, "add", "root.php"]);
    assert.deepEqual((await maintainedPhpFiles(directory)).sort(), names.map((name) => path.join(directory, name)).sort());
    for (const opening of ["<? echo 1; ?>", "<?echo 1; ?>", "<?xmlfake ?>"]) {
      await writeFile(path.join(directory, "bare"), opening);
      await assert.rejects(maintainedPhpFiles(directory), /Unsupported short PHP/);
    }
    await writeFile(path.join(directory, "bare"), "<?php\n// @phpstan-ignore-line\n");
    await assert.rejects(maintainedPhpFiles(directory), /must not suppress analysis/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
