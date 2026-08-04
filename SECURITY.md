# Security policy

## Supported versions

Only the latest compatible immutable template-pack release is maintained.
Historical releases remain available because consumers use them to verify
managed-file provenance and decide whether an update can be applied safely.

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for this
repository. Do not open a public issue for a vulnerability that could cause an
unsafe workflow, archive, release, or repository mutation.

Include the pack version, profile, logical entry ID, rendered output when safe,
and the security consequence. Do not include credentials or private repository
contents.

## Trust model

Template maintainers effectively review code that can later run in a target
repository's GitHub Actions environment. Protected branches, CODEOWNERS,
required tests, pinned Actions, deterministic builds, immutable releases, and
target-owner review are all required. Digest verification proves which bytes
were reviewed; it does not make arbitrary shell or YAML safe.

The pack manifest cannot select target paths, operations, triggers, or
permissions. Release Deployments accepts only its exact supported consumer API
and closed set of logical IDs and placeholders. An incompatible or malformed
pack must fail closed.
