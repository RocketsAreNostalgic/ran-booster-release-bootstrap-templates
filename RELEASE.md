# Release process

1. Use a Conventional Commit (`fix`, `feat`, or an explicit breaking change).
2. Require `npm test` and review the rendered plugin and theme fixtures.
3. Merge the Release Please pull request only after confirming `package.json`,
   `.release-please-manifest.json`, and release notes agree.
4. Quality runs the deterministic two-build fixture proof and stores an exact,
   hashed source-input archive for the matching commit. The privileged release
   workflow runs only after that main-push Quality run succeeds and proves the
   exact merged Release Please pull request and pending label.
5. Consumer API 1 embeds GitHub's numeric release ID, which does not exist until
   the draft is created. After that gated draft mutation, the release workflow
   extracts the Quality-produced inputs, finalizes the release-ID-bound pack
   exactly once, uploads or byte-compares the ZIP, and downloads it for
   authoritative readback. This is the intentional exception to prebuilding the
   final release asset in Quality; removing the release ID would break Consumer
   API 1.
6. Enable GitHub immutable releases and set the repository variable
   `RAN_IMMUTABLE_RELEASES_ENABLED=true` before publication. Otherwise the
   verified release intentionally remains a draft.
7. Never replace, delete, or retag a historical pack release. Publish a new
   patch release for a compatible template correction.

Patch and minor stable releases may change template bodies while the manifest schema,
logical IDs, placeholders, profiles, and consumer-owned capabilities remain
compatible with Consumer API 1. Any new consumer capability requires a new
consumer API and a corresponding Release Deployments release before the pack
is eligible.
