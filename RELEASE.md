# Release process

1. Use a Conventional Commit (`fix`, `feat`, or an explicit breaking change).
2. Require `npm test` and review the rendered plugin and theme fixtures.
3. Merge the Release Please pull request only after confirming `package.json`,
   `.release-please-manifest.json`, and release notes agree.
4. The release workflow builds the pack twice, compares the archives, verifies
   all manifest/member digests, creates or reuses one draft release, uploads or
   byte-compares one ZIP, and downloads it for authoritative readback.
5. Enable GitHub immutable releases and set the repository variable
   `RAN_IMMUTABLE_RELEASES_ENABLED=true` before publication. Otherwise the
   verified release intentionally remains a draft.
6. Never replace, delete, or retag a historical pack release. Publish a new
   patch release for a compatible template correction.

Patch and minor stable releases may change template bodies while the manifest schema,
logical IDs, placeholders, profiles, and consumer-owned capabilities remain
compatible with Consumer API 1. Any new consumer capability requires a new
consumer API and a corresponding Release Deployments release before the pack
is eligible.
