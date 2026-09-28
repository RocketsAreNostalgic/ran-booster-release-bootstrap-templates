# Release starter — consumer handoff reference

A renders bracketed identity values from the verified pack and target. This file
is documentation, not a sixth template or extra pack member.

Created once by Booster from:
- pack version/profile: [actual pack version] / [actual /3 profile]
- pack source commit and ZIP SHA-256: [actual values]
- shared publisher: RocketsAreNostalgic/.github, [actual pinned commit]
- setup PR: see this file's introducing commit and pull request

You own these files after setup. Booster does not update or repair them.

Setup PR created does not mean release automation is ready. You may receive this
proposal before configuring execution settings; Booster does not query repository
or organization immutability settings or require Administration permission.

Before activating workflows (recommended before merging):
- review every proposed file and the runtime allowlist;
- configure Actions/reusable-workflow access, runner availability, runtime token
  permissions, bot PR creation, immutable releases and protected-merge checks;
- distinguish the site-controlled setup credential from runtime GITHUB_TOKEN;
- review the PR's read-only Quality execution: a draft PR can run before merge;
- review what merging activates: main Quality and the shared release workflow;
- check the PR Quality result and subsequent main run when execution is available.
Administrative settings are owner-managed and not checked by Booster. Publication
remains strictly immutable; this recipe has no permissive publication mode.

For a release:
- use Conventional Commits and review Release Please's version/changelog PR;
- merge using your repository's approved method;
- require fresh main Quality and immutable release/ZIP readback;
- consumers install the attached ZIP, not GitHub's generated source archive.

Keep the allowlist current when adding runtime files. Add product-specific
checks deliberately; complex builds need a maintainer-owned release setup.
Never overwrite a published release or move its tag to repair a failure.

If no workflow runs, inspect Actions/workflow-policy acceptance and runner/account
availability in GitHub; in-job diagnostics cannot run before a job starts. For an
executing failure, use its stage/outcome and the shared Profile B publication and
retry guidance. A 403 alone does not identify a disabled setting or prove that no
branch, tag, draft or asset was created.
Publication precedes immutable readback. A confirmed public mutable release stays
public despite a red job; an inconclusive readback leaves the outcome unknown.
Enabling immutability and blindly rerunning cannot qualify that old release.
Inspect actual Release Please version/manifest/lifecycle and release/tag/asset state
before taking a maintainer-owned next-version path. No automatic rollback, label
repair, asset replacement or tag movement is supplied. Respect original event/SHA,
exact run/attempt artifact custody and current-main admission on retry. Manual
Quality dispatch does not admit publication. An open release PR or no releasable
change can be ordinary non-publication; do not infer failure merely from no release.

Security and maintenance:
- use the template pack repository SECURITY.md / private reporting route;
- follow its Security Advisories and linked release announcements;
- watch the pack and shared workflow repositories' release announcements;
- review affected revisions and apply manual fixes, including workflow repins.
Origin records do not prove customized code is currently affected or fixed.
On package adoption, Booster may validate the exact observed repository's passive
origin record and compare it read-only with published advisories for the canonical
pack/shared components. A specific match produces a warning and manual mitigation;
no match means only no matching known advisory in the checked information; missing,
invalid or unavailable provenance/advisory data is unknown/not assessed and does
not by itself block ordinary adoption. A newer starter alone is not a vulnerability.
There is no background scan, notification guarantee or repair service.

Official links:
- [Private pack reporting](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/security/advisories/new)
- [Pack advisories](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/security/advisories)
- [Pack releases](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/releases)
- [Shared security policy](https://github.com/RocketsAreNostalgic/.github/security/policy)
- [Shared advisories](https://github.com/RocketsAreNostalgic/.github/security/advisories)
- [Shared releases](https://github.com/RocketsAreNostalgic/.github/releases)
- [Publication stages and retry guidance](https://github.com/RocketsAreNostalgic/.github/blob/63c4a4b192bbb4cf203dab281b75a0907e85c3a9/RELEASE_PROFILE_B.md)

| Condition | Outcome and action |
| --- | --- |
| No run or workflow rejected | Inspect Actions policy/YAML and pinned-workflow access; no job can emit diagnostics. |
| Queued job | Inspect runner/account availability. |
| Bot cannot create a PR, write or merge is blocked | Inspect error and actual token/ruleset/check evidence; a 403 does not identify a setting. Preserve protections. |
| Exact required checks remain pending | Inspect the exact release-PR head and check event/source. Dispatched Quality is not protected-merge proof. |
| Missing protections with no CI error | Owner must configure intended merge protections; green CI does not certify settings. |
| Quality build/verification fails | Fix source and requalify. No privileged rebuild or alternative bytes. |
| Artifact unavailable/expired | Preserve run/attempt custody; obtain fresh main-push evidence where needed. |
| Open release PR/no releasable change | Ordinary non-publication can be successful. |
| Draft/tag/assets exist after failure | Inspect exact identity and digests before any stage-appropriate retry. |
| Publication readback inconclusive | Outcome unknown; inspect exact release ID, not a rollback assumption. |
| Public mutable release confirmed | It is public but failed strict qualification. Use reviewed next-version process, never clobber or tag movement. |

General consumption is separate: qualifying manual updates may use mutable
releases, while automatic updates retain immutable/provenance and all other
updater checks. Repository settings, the selected release's facts and the saved
Automatic/Manual preference are distinct. Turning settings off does not invalidate
an old immutable release; turning them on does not make an old mutable one
immutable. This starter does not change the user's saved policy.
