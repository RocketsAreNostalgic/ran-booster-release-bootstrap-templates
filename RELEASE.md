# Release process

The producer and generated starters use shared Profile B at reviewed landed commit
`63c4a4b192bbb4cf203dab281b75a0907e85c3a9`. The producer's shared Node quality baseline
remains pinned at `72a90b5826db37d1e94cdcdcf3374ccf58c0aa7d`.

Read-only Quality checks exact source on PR, main push and input-free dispatch.
`Pack inputs` now builds the final canonical ZIP twice, compares it and verifies
all members; its historical check name is retained for existing protections.
`Quality` and terminal `quality` require the complete evidence. Full `pnpm check`
also runs for bot release candidates. No publication uses the earlier input tar.

Quality uploads `ran-booster-release-bootstrap-templates-<run-id>-<attempt>` with
one public asset listed in `ran-profile-b-promotion.json`: the canonical ZIP and
its SHA-256. The source/quality SHA and tag bind the exact tested artifact. Other
Actions evidence is not published. The privileged caller has no checkout, build,
patch, repack, uploader or locally reproduced lifecycle engine.

Only a successful canonical main-push Quality run can admit shared publication.
Release Please owns version calculation, changelog, PR/tag/draft lifecycle; config
requires `draft: true` and `force-tag-creation: true`. The shared workflow qualifies
exact bot candidates using bounded input-free dispatch when needed, and promotes
only the triggering run/attempt's bytes. PR/manual-dispatch success alone cannot
publish. A dispatched green job is not proof that protected PR checks are satisfied.

Before any separately authorised publication, complete the actual producer/consumer
candidate exchange and applicable #81 integration gates. This API-3 PR is not merge
or release authority. Keep historical releases immutable; do not manually bump a
version, move a tag, replace an asset or publish an incomplete/bridge pack.

Owners configure Actions/access/runners, bot PR/token permissions, merge protections
and immutable releases. Booster does not probe repository/org settings or require
administrative attestation. Settings are not validated by setup-PR creation.

Publication happens before immutable readback. A red publisher can leave a public
mutable release; unavailable readback means unknown outcome. Inspect the identified
release/tag/assets and Release Please state before retrying. Never claim rollback,
blindly rerun, change labels or replace assets. Establish a reviewed next version
through Release Please and fresh main Quality when needed. Original event/SHA,
run/attempt custody and still-current main constraints continue to apply.

See the [shared publication and retry contract](https://github.com/RocketsAreNostalgic/.github/blob/63c4a4b192bbb4cf203dab281b75a0907e85c3a9/RELEASE_PROFILE_B.md)
and [operator handoff](docs/RELEASE-STARTER.md). Before marking a head qualified,
record native CI, separate `@codex review` and `@codex security review` outcomes and
all finding dispositions for that exact head. A changed head needs fresh evidence.
