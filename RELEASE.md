# Release process

1. Use a Conventional Commit (`fix`, `feat`, or an explicit breaking change).
2. Require `npm test` and review the rendered plugin and theme fixtures.
3. Merge the Release Please pull request only after confirming `package.json`,
   `.release-please-manifest.json`, and release notes agree.
4. Quality runs the complete test suite and stores an exact, hashed source-input
   archive for its commit. The privileged release workflow runs only after a
   same-repository main-push Quality run succeeds. Its candidate, archived
   inputs, future tag, release target, and pack-manifest commit are that
   successful merge SHA; the Release Please head is only exact pull-request and
   identical-tree eligibility evidence.
5. Consumer API 2 embeds GitHub's numeric release ID, which does not exist until
   the draft is created. After that gated draft mutation, the release workflow
   proves the downloaded Quality input tar byte-identical to a fresh
   `git archive` of the successful commit. It then projects the
   release-ID-bound pack from Git objects at that commit, uploads or
   byte-compares the ZIP, and downloads it for authoritative readback. This is
   the intentional exception to prebuilding the final release asset in Quality;
   removing the release ID would break Consumer API 2. An already-published or
   lost-acknowledgement rerun recovers the exact release ID, rebuilds the same
   commit, validates the single asset metadata, downloads it, and compares bytes
   without uploading or replacing anything.
6. Enable GitHub immutable releases and set the repository variable
   `RAN_IMMUTABLE_RELEASES_ENABLED=true` before publication. Otherwise the
   verified release intentionally remains a draft.
7. Never replace, delete, or retag a historical pack release. Publish a new
   patch release for a compatible template correction.

Patch and minor stable releases may change template bodies while the manifest
schema, logical IDs, placeholders, profiles, and consumer-owned capabilities
remain compatible with Consumer API 2. Any new consumer capability requires a
new consumer API and a corresponding Release Deployments release before the
pack is eligible.

## Consumer API 2 source-correction budget

The reviewed baseline contained 1,598 non-test tooling, template, data, and
workflow lines; 256 test and fixture lines; and a 403-line published template
payload. This correction contains 1,940 non-test lines (+342), 879 test and
fixture lines (+623), and a 543-line payload (+140). The growth is the bounded
candidate selector, exact release/tag/asset state inspection, immutable
published-rerun rebuild and byte readback, and the executable real-Git/fake-`gh`
failure matrix. It adds no PHP, package dependency, logical ID, placeholder, or
target path.

T2 source commit `c554543` raises those totals to 2,181 non-test lines (+241
from T1), 1,227 test and fixture lines (+348), and a 666-line published payload
(+123). The executable delta is the explicit-commit Git projection and
independent comparison at both archive layers; the test delta is the disposable
pack/plugin/theme Git histories, dirty-worktree, cross-umask, changed-commit,
wrong-commit, and invalid committed-entry outcomes. Staged archive modes are
canonicalized to 0755 directories and 0644 files. T2 adds no PHP, package
dependency, logical ID, placeholder, target path, settings, or publication.
