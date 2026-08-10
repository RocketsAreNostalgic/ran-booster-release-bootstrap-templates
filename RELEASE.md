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

Before starting a publication run, read back repository ruleset `20644157`
(`Main release integrity`) as active on `refs/heads/main`, with no bypass actor,
merge-commit pull requests, zero required approvals, strict GitHub Actions
checks `Pack inputs` and `Quality` from app ID `15368`, and deletion and
non-fast-forward rules. Also read back repository-level immutable releases as
enabled and the Actions variable as the exact lowercase string `true`. The
ruleset was created from an unprotected baseline; deleting it is the exact
rollback, but doing so invalidates publication eligibility.

## Prepublication evidence boundary

There is deliberately no final release ZIP before the draft exists. Consumer
API 2 requires the positive GitHub release ID inside `template-pack.json`, so
the exact publication sequence is successful Release Please merge and Quality
run, empty draft creation or recovery, release-ID-bound build and verification,
single upload, immutable publication, then downloaded-byte readback. A local
build with a synthetic release ID proves only the builder, manifest, profiles,
rendered plugin/theme fixtures and hostile verifiers.

The reviewed local fixture at commit `75c003a`, repository ID `1322743261` and
synthetic release ID `9007199254740991` built twice byte-identically at 13,418
bytes with SHA-256
`39cf06cd9988978442803d59c5222781651ee6f3c2cf2cc53afc4482084eea00`.
Both independent pack verifications and the full `npm test` plugin/theme matrix
passed, then the disposable ZIPs were removed. This is not a retained release
candidate: source still declares `0.2.0`, while immutable historical `v0.2.0`
is API 1 and cannot be replaced. The publication workflow must qualify the
future release merge and build the final bytes with its actual draft ID.

## Abandoned candidate recovery

An unpublished candidate is not a release and must never be marked
`autorelease: tagged`. Candidate `b288b28cfd9c77f4b998c32427f77af045b0e68b`
exposed that GitHub's release-by-tag endpoint does not return an exact draft.
Its empty draft, release ID `368032667`, was verified as mutable, stable,
targeted at that commit, and free of assets; it was then deleted before any tag
or publication. The merged Release Please pull request remains auditable as
`autorelease: abandoned`, while manifest, package, and unreleased changelog
state were restored to `0.2.0`.

Both repository and generated publishers now recover a unique draft from the
authenticated paginated release inventory and use its numeric release ID for
pending asset readback. A non-404 lookup failure, duplicate tag identity,
list-only published release, wrong target, wrong state, or wrong asset remains
blocking. Candidate `4b4a340d238eada8e73f12745e3f929788cb8942`
then exposed a separate bounded-consistency outcome: immediately after draft
creation, the authenticated inventory briefly returned no matching draft.
Publisher run `31418678601` stopped with only empty mutable draft `368116056`;
there was no tag, asset, publication, or tagged label. That draft was verified
and deleted, and pull request 8 was marked `autorelease: abandoned`.

Both publishers therefore provide an `inspect-created` operation that retries
only the exact absent-to-draft readback within a fixed delay window. It still
fails immediately on contradictory identity/state, and it fails closed if the
draft never becomes visible. Executable fake-GitHub outcomes cover delayed
visibility and bounded exhaustion. Release Please must generate a fresh
candidate containing this fix; controller-only bytes may never be substituted
for either abandoned candidate.

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

T3 source commit `55eff3e` raises those totals to 2,709 non-test lines (+528
from T2), 1,672 test and fixture lines (+445), and a 922-line published payload
(+256). Both archive owners now reject malformed structure, unsafe or colliding
paths, unexpected members, non-regular or executable types, unsupported flags
and methods, ZIP64, central/local contradictions, corrupt data, and fixed
archive/member/count/expanded-size/ratio budget violations before extraction.
The common hostile matrix proves that rejection does not invoke `unzip`, while
valid pack, plugin, and theme fixtures retain exact-commit and deterministic
outcomes. The pack limit is 2 MiB / 32 members / 256 KiB per member / 1 MiB
expanded / 200:1; generated WordPress ZIPs use 50 MiB / 10,000 members /
127,826,407 bytes per member and total / 200:1. Two builds from the committed
T3 object were byte-identical at 13,412 bytes with SHA-256
`d486d9de8fb3ed88e943644b9bdcd07b2f1fca7cfa4a761326552942f500f157`.
T3 adds no PHP, package dependency, consumer API, logical ID, placeholder,
profile, target path, setting, runtime change, or publication.
