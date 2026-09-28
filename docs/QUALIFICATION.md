# Producer qualification and responsibility map

References: G0 #84 `3be15ce9d67688f2b6c15d9563791d315fce780f`; explanatory #86
`7bb26782f53ae0ba9fab066f249576faa63a7d4a`, contract blob
`2886a789d3e79ae623460a71eedcdfd665ec6cd2`, examples blob
`015d6aceaec5d84676438bea1848b3d521120ee7`; shared Profile B #87
`63c4a4b192bbb4cf203dab281b75a0907e85c3a9`.

## Execution change

Before: Quality checked source/input tar → local privileged release-candidate
reconstruction → create draft/numeric release ID → rebuild ZIP → local
upload/publish/label/recovery logic.

After: read-only exact-source Quality → full checks + two identical final ZIPs +
member verification + run/attempt-bound promotion evidence → thin reviewed shared
Profile B caller → Release Please lifecycle and exact tested-asset promotion →
strict immutable readback. No product source runs in the privileged caller.

Generated target: PR/main/input-free dispatch → exact committed explicit payload
projection → two normalized ZIP builds → independent bounded verification + PHP
syntax checks → run-bound artifact. Only canonical successful main-push evidence
can enter shared publication. The initial setup PR does not certify readiness.

| Responsibility | Disposition | Evidence |
| --- | --- | --- |
| API source/schema/profile/placeholder checks | Keep and migrate to closed API 3 | Source checks, duplicate-key/type/encoding negatives, exact path map |
| Five generated files | Keep necessary quality/config/build/verify and thin caller | Both rendered profiles; actual ZIP fixture render/digests |
| Generic release-candidate, label/draft/upload/recovery engine | Delete local scripts/templates/fake-GH tests | Delegated to landed Profile B; caller/config/pin contract tests |
| Input tar and release-ID-dependent finalization | Remove | Quality builds and compares final ZIP; promotion SHA/tag/digest tests |
| Historical immutable releases | Preserve | No release/tag/asset operations in this work |
| Source projection, dirty-file isolation, modes/order/time | Keep; require sorted explicit files | Real-Git plugin/theme fixtures; changed commit, dirty/untracked, umask and allowlist failures |
| ZIP structural/resource/path/type/CRC bounds | Keep pre-extraction checks | Hostile archive matrix for pack and rendered release; extraction sentinel |
| Generated ZIP inspector runtime | Same central/local-record algorithm, adapted to already selected PHP/zlib | Hostile matrix retained; no Node/package-manager install in generated workflow |
| Metadata/URI/compatibility/LFS | Keep or tighten | Wrong URI/version/PHP/WordPress and unresolved pointer negatives |
| Old API-2 profiles, duplicate RP config and upload template | Delete | Fixed five-entry/six-member archive assertion |
| Advisory index | Add repository-only bounded metadata | Empty/current and both identity types; malformed/duplicate/oversized/contradictory tests |
| Advisory publication, matching, freshness and display | Consumer + maintainer responsibilities | Producer shape validation does not claim live GHSA proof |
| Human handoff and passive provenance | Consumer-owned output; B supplies current reference guidance | `docs/RELEASE-STARTER.md`; not extra pack members |
| UI/manual setup and generated release execution | Deferred under #81 | No source/fixture check claims installed acceptance |

`pnpm check` remains the full local aggregate. `Pack inputs`, `Quality` and terminal
`quality` names are retained for current repository protections. Generated targets
have one `Quality` job and deliberate product-specific extensions remain their
maintainer's responsibility.

## Exact exchange

For the final producer head record native run ID, attempt and artifact ID. Download
that artifact, verify its canonical ZIP's SHA-256, and use `producer-exchange.json`
for manifest and per-profile template/rendered digests. An artifact ID is assigned
by GitHub after upload, so the in-artifact envelope deliberately leaves it null;
the PR handoff supplies the actual ID from that run's artifact listing.

A must run the candidate Provider's real parser/renderer against this local ZIP,
not an independently hand-authored pack or Core's older bundled copy. Compare
plugin/theme normalized target-file digests and negative protections. Any simulated
release/asset transport facts for the unpublished candidate must be labelled
fixtures and must not enter pack bytes or production discovery. A's actual parsing,
transaction/V3 work and C's combined/installed tuple proof remain separate gates.

The ZIP version/tag fields describe a candidate identity, not a published release.
After any source change, repeat exact-head tests, native CI and separate code/security
reviews. Merge, publication, released consumer adoption and live target/site proof
require separate decisions. Final run/review/digest evidence belongs in #22/#23 and
#55/#56/#81; this document does not assert those future results.
