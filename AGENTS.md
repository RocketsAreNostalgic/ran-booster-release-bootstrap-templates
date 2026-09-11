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
- Consumer API 2 is the sole forward contract. Historical Consumer API 1 packs
  remain immutable evidence and are not supported setup or update authority.
  A new placeholder, logical ID, profile, manifest field, workflow trigger,
  permission, or consumer capability requires a new consumer API and a
  compatible Release Deployments release.
- Published assets and historical releases are immutable. Never replace a pack
  asset for an existing tag.

## Required checks

Run `npm test`. It validates the source contract and real-Git release-candidate
decisions, renders plugin and theme fixtures, checks JSON and shell syntax,
builds the pack twice, compares the bytes, and verifies the archive and member
digests. Full tests are mandatory on every pull request, including Release
Please pull requests.

Release Please owns `CHANGELOG.md`; keep `/CHANGELOG.md` in `.prettierignore`.
Use Conventional Commits. Do not manually edit release tags or generated
changelog content.

## External AI agent prohibition

Do not invoke, delegate work to, tag, enable, or otherwise use Blacksmith [code]smith,
`@codesmith-bot`, Blacksmith Autofix, Blacksmith CI Tuning, Blacksmith Testbox agents,
or any other Blacksmith AI/agent feature.

Blacksmith may be used only as infrastructure for ordinary GitHub Actions runners where
the repository workflow explicitly specifies a Blacksmith runner.

Do not click or trigger "Enable autofix", do not ask [code]smith to investigate or repair
CI, and do not call Blacksmith agent/MCP/CLI/API features that perform AI inference.

If CI fails, inspect GitHub Actions logs directly and diagnose/fix the failure yourself.

This prohibition is a cost-control requirement and must not be overridden by convenience,
CI failure, review comments, or suggestions from GitHub/Blacksmith UI.
