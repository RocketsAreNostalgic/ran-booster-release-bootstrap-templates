# AGENTS.md

This repository publishes reviewed template packs consumed by RAN Booster
Release Deployments. It is an independent product, not a WordPress plugin.

## Safety boundary

- Pack manifests may declare only logical IDs, pack-internal source paths,
  placeholders, versions, byte sizes, and SHA-256 digests.
- Never add target repository paths, write operations, ownership modes,
  workflow permissions, workflow triggers, or mutation instructions to the
  manifest. The consumer owns those decisions.
- Do not add executable package dependencies. Template files may become CI or
  shell code in another repository, so every change requires fixture rendering
  and review of the exact generated output.
- Consumer API 1 is exact. A new placeholder, logical ID, profile, manifest
  field, workflow trigger, permission, or consumer capability requires a new
  consumer API and a compatible Release Deployments release.
- Published assets and historical releases are immutable. Never replace a pack
  asset for an existing tag.

## Required checks

Run `npm test`. It validates the source contract, renders plugin and theme
fixtures, checks JSON and shell syntax, builds the pack twice, compares the
bytes, and verifies the archive and member digests.

Release Please owns `CHANGELOG.md`; keep `/CHANGELOG.md` in `.prettierignore`.
Use Conventional Commits. Do not manually edit release tags or generated
changelog content.
