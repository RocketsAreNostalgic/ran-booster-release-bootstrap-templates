# RAN Booster release bootstrap templates

This public repository publishes immutable, independently reviewable template
packs for the source-ready release bootstrap in RAN Booster Release
Deployments. It contains no WordPress runtime code and cannot change a target
repository by itself.

The existing immutable `v0.2.0` release is historical Consumer API 1 evidence.
Release Deployments does not yet consume a supported published pack. A future,
separately authorised Release Deployments integration will select one exact
stable Consumer API 2 release, verify its repository and release identity,
archive digest, manifest, and every member digest, then render a draft pull
request for the repository owner to review. It will not execute pack code inside
WordPress or read templates from a branch or raw URL.

## Consumer API 2

Consumer API 2 is the sole forward source generation and declares two
stable-release profiles:

- `source-ready-wordpress-plugin/2`
- `source-ready-wordpress-theme/2`

Prerelease configuration requires a future consumer API because inert literal
substitution must not conditionally add Release Please behavior.

The manifest contains only logical entry IDs and pack-internal metadata. The
consumer maps those IDs to target paths and owns every operation, permission,
trigger, bounded edit, and placeholder validation rule. A pack cannot grant
itself a new capability.

The generated target bundle includes a managed two-event Release Please
workflow, a Release Please configuration, deterministic build and verification
scripts, an exact release upload/readback script, and a runtime allowlist. A
push prepares version and notes only. Publication requires the successful
same-repository main-push SHA from the named Quality workflow and an exact
merged Release Please pull request for that SHA. Release Please uses the
`simple` strategy and a root `CHANGELOG.md`; the consumer also creates or safely
extends root `.prettierignore` with `/CHANGELOG.md`.

Both the pack and the generated plugin/theme builders require an explicit Git
commit. Version sources, allowlists, headers, manifest inputs, and every
archived payload byte are projected from that commit; dirty tracked or
untracked checkout files are not artifact authority. Their verifiers
independently compare the archive with the same committed projection.

A locally supplied release ID produces a deterministic contract fixture only.
It is not candidate or publication evidence: Consumer API 2 embeds the real
GitHub release ID, which does not exist until the separately authorised release
workflow creates or recovers its exact draft. That workflow then builds the
final ZIP from the successful Quality commit and actual release tuple before
upload and immutable readback. In particular, current source version `0.2.0`
must never be confused with or substituted for the historical immutable API 1
release at `v0.2.0`.

After draft creation, both the repository publisher and every generated
publisher use a bounded exact-draft discovery readback. They tolerate only the
brief absent-to-draft propagation window; contradictory identities, API errors,
or a draft that remains unavailable fail closed before any asset upload.

Before extraction, both verifiers parse the ZIP central directory and local
records, reject unsafe or ambiguous paths and member types, enforce fixed
archive, member, expanded-size, and compression-ratio limits, and validate each
stored or deflated member's actual length and CRC. They then prove the exact
expected member set before allowing `unzip` to inspect or extract the archive.
The template pack is limited to 2 MiB, 32 members, 256 KiB per member, 1 MiB
expanded, and a 200:1 ratio. Generated WordPress release ZIPs use the updater's
50 MiB archive, 10,000-member, and 127,826,407-byte expanded envelope with the
same fixed ratio.

The `main` branch is protected by the active `Main release integrity` ruleset:
pull requests use normal merge commits, both `Pack inputs` and `Quality` must
pass from GitHub Actions against current `main`, no second-human approval is
required, and force pushes and deletion are blocked. Immutable releases are
enabled and `RAN_IMMUTABLE_RELEASES_ENABLED=true`; these settings are necessary
preconditions and do not themselves authorize a release.

## Development

Requirements: Node.js 20 or newer, Bash, `zip`, `unzip`, and `shasum`.

```sh
npm test
npm run build -- dist <repository-id> <release-id> v0.2.0 <release-commit>
bash scripts/verify-pack.sh dist/ran-booster-release-bootstrap-templates.zip \
  <repository-id> <release-id> v0.2.0 <release-commit>
```

Every release contains one fixed-name asset,
`ran-booster-release-bootstrap-templates.zip`; its manifest and immutable
release identity carry the pack version.
See [RELEASE.md](RELEASE.md) before publishing and [SECURITY.md](SECURITY.md)
for the trust model and vulnerability reporting policy.
