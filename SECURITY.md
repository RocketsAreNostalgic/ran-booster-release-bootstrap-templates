# Security policy

## Scope and reporting

The current supported starter and pinned shared release components are maintained;
repository owners maintain their generated copies. Historical immutable releases
are evidence only, not authority for old-format setup or managed-template updates.
Ben is the designated RAN maintainer for triage, fixes and disclosure. Before public
feature acceptance, the coordinator must verify the private reporting route and
supported release scope; this source document does not certify that verification.

Report privately through [this repository's security reporting page](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/security/advisories/new).
For shared-workflow defects use [the shared repository policy](https://github.com/RocketsAreNostalgic/.github/security/policy).
Do not include credentials/private repository contents or disclose vulnerabilities
in public planning comments. Supply affected pack/profile/revision, safe rendered
examples and impact.

## Maintenance index

Maintain `security/release-starter-advisories.json` alongside the corresponding
published GHSA and manual mitigation guidance. Run `pnpm check` after changes.
The canonical index is bounded to 64 KiB and 64 unique entries; identities are
exact stable pack versions or exact shared Profile B commits, never ranges or
mutable refs. Empty means no entries supplied, not a safety certificate. The index
is repository maintenance metadata; it is excluded from public ZIPs and targets.

Producer validation proves shape, identity bounds, uniqueness and consistency.
It does not query GitHub or claim the linked GHSAs are published. The consumer must
cross-check each GHSA against its named canonical repository, including published,
non-withdrawn state, before reporting any result. Missing, invalid, inaccessible or
stale information is unknown/not assessed, never safe. Publish affected identities,
fixed revisions and manual mitigation, including required workflow repins.

Follow [pack advisories](https://github.com/RocketsAreNostalgic/ran-booster-release-bootstrap-templates/security/advisories),
[shared advisories](https://github.com/RocketsAreNostalgic/.github/security/advisories)
and their release announcements. A newer starter is informational, not a
vulnerability. Passive origin records cannot establish whether customised or
backported code is affected or fixed. There is no background scanner, notification
guarantee, automatic repair or later template-update service.

## Trust boundary

Review exact generated output as executable CI source before adoption. Pack byte
digests bind reviewed bytes; they do not make arbitrary workflows safe. Preserve
archive/resource/path/type/encoding/CRC/digest checks and literal substitution.
Manifests cannot grant target paths, operations, modes, permissions or triggers.
Initial setup must preserve user/nonce/credential/target-head/conflict protections.

Publication uses exact read-only-tested assets and mandatory immutable readback.
The caller has no privileged target code execution or rebuild. Owner-managed
settings are separate from actual release facts; a failed immutable readback may
follow publication. Never repair historical assets/tags or weaken protections.
