# RAN Booster release bootstrap templates

This repository produces reviewed **Consumer API 3** initial release starters for
one source-ready WordPress plugin or theme at a GitHub repository root. The target
must use `main`, stable SemVer, committed installable files and a reviewed explicit
runtime allowlist. Complex builds, existing automation and ambiguous package
metadata require manual integration. This is not a build-framework detector.

The controlling contract is [G0](https://github.com/RocketsAreNostalgic/.github/blob/7bb26782f53ae0ba9fab066f249576faa63a7d4a/BOOTSTRAP_STARTER_CONTRACT.md),
with [examples](https://github.com/RocketsAreNostalgic/.github/blob/7bb26782f53ae0ba9fab066f249576faa63a7d4a/BOOTSTRAP_STARTER_EXAMPLES.md).
The frozen technical contract came from #84; #86 clarified execution prerequisites
and deferred UI/manual acceptance without changing the format. Current work is
tracked in [#22](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/issues/22)
and [programme #81](https://github.com/RocketsAreNostalgic/.github/issues/81).
This source does not establish consumer convergence, publication or installed
feature acceptance. Historical immutable API-1/API-2 assets remain untouched.

## Pack boundary

One `ran-booster-release-bootstrap-templates.zip` contains exactly six inert
regular files: `template-pack.json` and five shared templates. Both
`source-ready-wordpress-plugin/3` and `source-ready-wordpress-theme/3` map the same
five logical entries; header/package placeholders supply necessary differences.

| Logical entry | Consumer-owned destination |
| --- | --- |
| quality-workflow | `.github/workflows/quality.yml` |
| release-workflow | `.github/workflows/release-please.yml` |
| release-please-config | `release-please-config.json` |
| build-release-script | `scripts/build-release.sh` |
| verify-release-script | `scripts/verify-release.sh` |

The manifest binds canonical repository name/numeric repository ID, stable pack
version, tag and exact source commit. It declares member paths, sizes, digests and
literal placeholder types only. Numeric release/asset IDs are separately verified
transport facts and are never build inputs. Metadata grants no destinations,
writes, permissions, triggers or executable capabilities. The consumer owns the
closed output map, validated literal replacement and confirmation-time re-fetch.
Nothing in a downloaded pack executes on WordPress.

The consumer additionally creates version/manifest/allowlist inputs, passive
`.ran-booster-release-starter.json` and `RELEASE-STARTER.md`. These are not extra pack
members. [Operator guidance](docs/RELEASE-STARTER.md) is B's reference handoff for A;
A must render its verified origin values and actual target details. After the
initial draft setup PR, maintainers own the files. There is no update engine,
automatic repair, fallback format or bridge release.

## Build and checks

Use Node **24.21.0** and pnpm **11.13.1**. No executable npm dependencies are needed.
The checks also require Git, Bash, jq, zip/unzip, SHA-256 utilities and PHP with zlib
for rendered adapter verification. Generated repositories use their reviewed PHP
runtime on `ubuntu-24.04`; they do not install Node or a package manager. The
retained ZIP inspector's central/local/header/CRC checks use that existing PHP
runtime, never target PHP code.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm run build -- dist 1322743261 v0.2.1 <exact-source-commit>
bash scripts/verify-pack.sh dist/ran-booster-release-bootstrap-templates.zip 1322743261 v0.2.1 <exact-source-commit>
node scripts/pack-evidence.mjs dist/ran-booster-release-bootstrap-templates.zip dist
```

Use the version from the selected commit, not the illustrative version above.

`pnpm check` first runs `pnpm analyze`: PHPStan **2.2.8**, Level **8**, with
PHP **7.4** analysis semantics and `treatPhpDocTypesAsCertain: false`. It extracts
the exact shipped `RAN_ARCHIVE_INSPECTOR` heredoc bytes into a temporary file and
proves the locked checker rejects a nullable-access negative control. The
producer needs PHP **8.2 or newer** to run this development tool; generated
inspectors retain their PHP 7.4–8.5 runtime contract.

The external PHAR is downloaded from the official PHPStan release on each run,
verified against SHA-256
`ab9ea72523fe453b9f4dd19f12b1e403a91efa894cd25d9b0cb3ef62b7d20bf2`
before execution, and removed with temporary analysis files on exit. A network
or checksum failure fails the check. For offline runs, set `RAN_PHPSTAN_PHAR` to
an already downloaded PHAR; the same digest check applies. This adds no Composer
project, npm executable dependency, shipped analyzer or consumer requirement.
The unchanged shared Node Quality workflow runs the same `pnpm check` command.

A finite literal-scope check rejects missing or duplicate inspector delimiters,
additional PHP openings, literal executable `php` commands and PHP-named files throughout
the template tree. The existing exact consumer `php -l` syntax-only command is
allowed because it does not execute input. New executable template PHP needs an
explicit coverage change. Ordinary maintained PHP files are discovered recursively without honoring `.gitignore`, by PHP filename or
opening PHP tag (including BOM/shebang, short echo and mixed HTML), and
analyzed independently; the stream-wrapper test fixture is included. Only the
root `.git`, `node_modules`, `dist`, `build` and
`.ran-booster-template-pack-dist` working directories are omitted. Unsupported
bare short PHP openings fail discovery. Embedded PHP strings in Node `.mjs`
files and Markdown `.md` examples are data; leading PHP in those files still
enters analysis. The one shipped template is extracted separately. This
is not a shell interpreter and does not detect arbitrary dynamic command
construction; exact generated-output review remains required. It makes no
claim to analyze PHP fixture data in the producer's JavaScript tests.

The full suite renders both profiles, builds real Git fixtures, compares dirty
versus clean inputs and different umasks, tests committed projection and metadata
failures, and rejects hostile archives before extraction. It independently builds
and verifies the pack twice. ZIP/path/member/resource/encoding/digest controls and
ambiguous JSON-key rejection remain mandatory. [Gate migration](docs/QUALIFICATION.md)
records retained, delegated and removed responsibilities.

Read-only Quality uploads exact tested bytes, the Profile B promotion manifest,
producer exchange metadata and actual plugin/theme rendered fixtures. The envelope
records the source/digests/run/attempt; obtain the artifact ID from the upload's
actual run. A must test these actual bytes through the candidate PHP consumer.
Synthetic transport facts for this unpublished candidate are fixtures only.

The bounded `security/release-starter-advisories.json` is current repository
maintenance metadata, never a pack member or a target payload. See [SECURITY.md](SECURITY.md).
