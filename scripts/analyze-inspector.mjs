import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const phpstanVersion = "2.2.8";
export const phpstanSha256 = "ab9ea72523fe453b9f4dd19f12b1e403a91efa894cd25d9b0cb3ef62b7d20bf2";
const root = fileURLToPath(new URL("../", import.meta.url));
const opening = 'RAN_ARCHIVE_PATH="$archive" php -d memory_limit=512M > "$actual" <<\'RAN_ARCHIVE_INSPECTOR\'\n';
const closing = "\nRAN_ARCHIVE_INSPECTOR\n";

// This is a finite check of the shipped literal PHP surface, not a shell parser.
export function extractInspector(sources) {
  const filename = "shared/verify-release.sh.tmpl";
  const source = sources.get(filename);
  assert(source, "Missing inspector template.");
  const text = source.toString("utf8");
  assert.equal(text.split(opening).length, 2, "Expected one exact inspector invocation.");
  assert.equal(text.split(closing).length, 2, "Expected one inspector closing delimiter.");
  const start = source.indexOf(Buffer.from(opening)) + Buffer.byteLength(opening);
  const end = source.indexOf(Buffer.from(closing));
  assert(end > start, "Empty or misplaced inspector.");
  const inspector = source.subarray(start, end + 1);
  assert(inspector.toString("utf8").startsWith("<?php\n"), "Inspector must start with PHP.");
  assert(!/@phpstan-ignore/i.test(inspector.toString("utf8")), "Inspector must not suppress analysis.");
  for (const [name, bytes] of sources) {
    assert(!/\.php(?:\.|$)/i.test(name), `Unexpected PHP file: ${name}`);
    let rest = name === filename
      ? Buffer.concat([bytes.subarray(0, start - Buffer.byteLength(opening)), bytes.subarray(end + closing.length)]).toString("utf8")
      : bytes.toString("utf8");
    // The existing consumer syntax-only invocation never executes its input.
    if (name === "shared/quality.yml.tmpl") {
      rest = rest.replace(/^          find "\$work\/payload" -type f -name '\*\.php' -print0 \| xargs -0 -r -n1 php -l$/m, "");
    }
    assert(!/<\?(?:php\b|=)/i.test(rest), `Unexpected PHP opening: ${name}`);
    assert(!/(?:^|[\s;&|()])php(?:\s|$)/m.test(rest), `Unexpected literal PHP invocation: ${name}`);
  }
  assert.equal((inspector.toString("utf8").match(/<\?(?:php\b|=)/gi) || []).length, 1, "Unexpected PHP opening in inspector.");
  return inspector;
}

async function templateSources(directory, relative = "", sources = new Map()) {
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) await templateSources(directory, name, sources);
    else {
      assert(entry.isFile(), `Unexpected nonregular template: ${name}`);
      sources.set(name, await readFile(path.join(directory, name)));
    }
  }
  return sources;
}

export async function maintainedPhpFiles(directory = root) {
  const files = [];
  const disposableRoots = new Set([".git", "node_modules", "dist", "build", ".ran-booster-template-pack-dist"]);
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (!relative && disposableRoots.has(entry.name)) continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else {
        assert(entry.isFile(), `Unexpected nonregular maintained file: ${name}`);
        const text = (await readFile(path.join(directory, name))).toString("utf8");
        const phpName = /\.(?:php[0-9]?|phtml|inc)$/i.test(name);
        const phpStart = /^(?:\uFEFF)?(?:#![^\n]*\n)?\s*<\?/i.test(text);
        const phpContent = /<\?/i.test(text);
        // JS fixture strings and Markdown examples are data, not PHP programs.
        // The one shipped template is checked and extracted separately above.
        const embeddedData = /\.(?:mjs|md)$/i.test(name) || name === "templates/shared/verify-release.sh.tmpl";
        if (phpName || phpStart || (phpContent && !embeddedData)) {
          assert(!/@phpstan-ignore/i.test(text), `Maintained PHP must not suppress analysis: ${name}`);
          assert(!/<\?(?!php\b|=)/i.test(text), `Unsupported short PHP opening: ${name}`);
          files.push(path.join(directory, name));
        }
      }
    }
  }
  await visit();
  return files;
}

export function verifyAnalyzer(bytes) {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), phpstanSha256, "PHPStan PHAR SHA-256 mismatch; refusing execution.");
}

export async function analyzeInspector() {
  const inspector = extractInspector(await templateSources(path.join(root, "templates")));
  const temporary = await mkdtemp(path.join(tmpdir(), "ran-inspector-analysis-"));
  try {
    let bytes;
    if (process.env.RAN_PHPSTAN_PHAR) bytes = await readFile(process.env.RAN_PHPSTAN_PHAR);
    else {
      const response = await fetch(`https://github.com/phpstan/phpstan/releases/download/${phpstanVersion}/phpstan.phar`, { signal: AbortSignal.timeout(120000) });
      assert(response.ok, `PHPStan download failed: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    verifyAnalyzer(bytes);
    const phar = path.join(temporary, "phpstan.phar");
    await writeFile(phar, bytes);
    await writeFile(path.join(temporary, "inspector.php"), inspector);
    await writeFile(path.join(temporary, "phpstan.neon"), "parameters:\n    level: 8\n    phpVersion: 70400\n    treatPhpDocTypesAsCertain: false\n    tmpDir: cache\n    parallel:\n        maximumNumberOfProcesses: 1\n");
    const run = (filename) => {
      const result = spawnSync("php", [phar, "analyse", "--configuration=phpstan.neon", "--no-progress", "--error-format=json", filename], { cwd: temporary, encoding: "utf8", timeout: 120000 });
      if (result.error) throw result.error;
      return result;
    };
    const result = run("inspector.php");
    assert.equal(result.status, 0, `Inspector Level 8 analysis failed:\n${result.stdout}\n${result.stderr}`);
    const maintained = await maintainedPhpFiles();
    for (const filename of maintained) {
      const physical = run(filename);
      assert.equal(physical.status, 0, `Maintained PHP Level 8 analysis failed (${filename}):\n${physical.stdout}\n${physical.stderr}`);
    }
    // The real locked checker must reject a nullable dereference (Level 8).
    await writeFile(path.join(temporary, "negative.php"), "<?php\nclass RanNegative { public string $name; }\nfunction ran_negative(?RanNegative $value): string { return $value->name; }\n");
    const negative = run("negative.php");
    assert.equal(negative.status, 1, `PHPStan negative control did not fail normally:\n${negative.stdout}\n${negative.stderr}`);
    const report = JSON.parse(negative.stdout);
    assert.equal(report.totals.errors, 0, "Negative control had global errors.");
    const messages = Object.values(report.files).flatMap((file) => file.messages);
    assert(messages.some((message) => message.identifier === "property.nonObject"), "Locked checker did not reject nullable access.");
    console.log(`PHPStan ${phpstanVersion}: shipped inspector and ${maintained.length} maintained PHP files Level 8 clean; PHP 7.4 semantics; nullable negative control passed.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await analyzeInspector();
}
