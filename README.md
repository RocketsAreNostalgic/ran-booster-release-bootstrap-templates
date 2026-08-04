# RAN Booster release bootstrap templates

This public repository publishes immutable, independently reviewable template
packs for the source-ready release bootstrap in RAN Booster Release
Deployments. It contains no WordPress runtime code and cannot change a target
repository by itself.

Release Deployments selects the highest compatible published pack, verifies
its repository and GitHub release identity, archive digest, manifest, and every
member digest, then renders a draft pull request for the repository owner to
review. It never executes pack code inside WordPress and never reads templates
from a branch or raw URL.

## Consumer API 1

Consumer API 1 supports two stable-release profiles:

- `source-ready-wordpress-plugin/1`
- `source-ready-wordpress-theme/1`

Prerelease configuration requires a future consumer API because inert literal
substitution must not conditionally add Release Please behavior.

The manifest contains only logical entry IDs and pack-internal metadata. The
consumer maps those IDs to target paths and owns every operation, permission,
trigger, bounded edit, and placeholder validation rule. A pack cannot grant
itself a new capability.

The generated target bundle includes a managed Release Please workflow, a
Release Please configuration, deterministic build and verification scripts,
an exact release upload/readback script, and a runtime allowlist. Release
Please uses the `simple` strategy and a root `CHANGELOG.md`; the consumer also
creates or safely extends root `.prettierignore` with `/CHANGELOG.md`.

## Development

Requirements: Node.js 20 or newer, Bash, `zip`, `unzip`, and `shasum`.

```sh
npm test
npm run build -- dist <repository-id> <release-id> v0.1.0 <release-commit>
bash scripts/verify-pack.sh dist/ran-booster-release-bootstrap-templates.zip \
  <repository-id> <release-id> v0.1.0 <release-commit>
```

Every release contains one fixed-name asset,
`ran-booster-release-bootstrap-templates.zip`; its manifest and immutable
release identity carry the pack version.
See [RELEASE.md](RELEASE.md) before publishing and [SECURITY.md](SECURITY.md)
for the trust model and vulnerability reporting policy.
