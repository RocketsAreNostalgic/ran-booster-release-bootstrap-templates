import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const [candidate, repository, defaultBranch, expectedHead, pullRequestsFile] =
  process.argv.slice(2);

assert(/^[0-9a-f]{40}$/.test(candidate ?? ""), "Candidate SHA is invalid.");
assert(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ""),
  "Repository identity is invalid.",
);
assert(validBranch(defaultBranch), "Default branch is invalid.");
assert(validBranch(expectedHead), "Release Please branch is invalid.");
assert(pullRequestsFile, "Pull request evidence is required.");
const controlCommit = process.env.RAN_RELEASE_CONTROL_COMMIT ?? "";
if (controlCommit) {
  assert(
    process.env.RAN_RELEASE_RECOVERY === "31417475890:2",
    "Release recovery tuple is invalid.",
  );
  assert(
    candidate === "4b4a340d238eada8e73f12745e3f929788cb8942",
    "Release recovery candidate is invalid.",
  );
  assert(
    /^[0-9a-f]{40}$/.test(controlCommit),
    "Release control commit is invalid.",
  );
  assert(
    git("rev-parse", "HEAD") === controlCommit,
    "HEAD is not the release control commit.",
  );
  const controlAncestry = git(
    "rev-list",
    "--parents",
    "-n",
    "1",
    controlCommit,
  ).split(" ");
  assert(
    controlAncestry.length === 3 &&
      controlAncestry[0] === controlCommit &&
      controlAncestry[1] === candidate,
    "Release control parent is invalid.",
  );
  assert(
    git("rev-parse", `${controlCommit}^{tree}`) ===
      git("rev-parse", `${controlAncestry[2]}^{tree}`),
    "Release control tree differs from its correction head.",
  );
  assert(
    JSON.stringify(
      git("diff", "--name-only", candidate, controlCommit).split("\n"),
    ) ===
      JSON.stringify([
        ".github/workflows/quality.yml",
        ".github/workflows/release-please.yml",
        "scripts/release-candidate.mjs",
        "scripts/upload-pack.sh",
        "tests/run.mjs",
      ]),
    "Release control changes exceed the recovery allowlist.",
  );
} else {
  assert(git("rev-parse", "HEAD") === candidate, "HEAD is not the candidate.");
}

const ancestry = git("rev-list", "--parents", "-n", "1", candidate).split(" ");
assert(
  ancestry.length === 3 && ancestry[0] === candidate,
  "Candidate is not a normal two-parent merge.",
);
const [, baseCommit, releaseHead] = ancestry;
assert(
  changed(baseCommit, candidate, ".release-please-manifest.json"),
  "Candidate does not change the Release Please manifest.",
);
const manifestOwner = git(
  "log",
  "-1",
  "--format=%H",
  releaseHead,
  "--",
  ".release-please-manifest.json",
);
assert(manifestOwner, "Release Please manifest owner is missing.");
assert(
  git("rev-parse", `${manifestOwner}^`) === baseCommit &&
    spawnSync("git", [
      "merge-base",
      "--is-ancestor",
      manifestOwner,
      releaseHead,
    ]).status === 0,
  "Release Please head does not own the manifest change.",
);
assert(
  JSON.stringify(
    git("diff", "--name-only", baseCommit, manifestOwner).split("\n"),
  ) ===
    JSON.stringify([
      ".release-please-manifest.json",
      "CHANGELOG.md",
      "package.json",
    ]),
  "Release Please manifest commit changes unexpected paths.",
);
assert(
  git("rev-list", "--merges", `${baseCommit}..${releaseHead}`) === "",
  "Release Please head contains a merge commit.",
);
const postManifestChanges = git(
  "diff",
  "--name-only",
  manifestOwner,
  releaseHead,
)
  .split("\n")
  .filter(Boolean);
assert(
  postManifestChanges.every((file) => file === "CHANGELOG.md"),
  "Release Please post-manifest changes exceed the changelog correction boundary.",
);
assert(
  git("rev-parse", `${candidate}^{tree}`) ===
    git("rev-parse", `${releaseHead}^{tree}`),
  "Candidate and Release Please head trees differ.",
);

const version = JSON.parse(
  git("show", `${candidate}:.release-please-manifest.json`),
)["."];
const packageVersion = JSON.parse(
  git("show", `${candidate}:package.json`),
).version;
assert(stableVersion(version), "Release version is not stable SemVer.");
assert(packageVersion === version, "Release version sources disagree.");

const pullRequestPages = JSON.parse(await readFile(pullRequestsFile, "utf8"));
assert(
  Array.isArray(pullRequestPages),
  "Pull request evidence must be an array.",
);
const pullRequests = pullRequestPages.flat();
const eligible = pullRequests.filter(
  (pullRequest) =>
    pullRequest?.merged_at != null &&
    pullRequest?.base?.ref === defaultBranch &&
    pullRequest?.base?.sha === baseCommit &&
    pullRequest?.base?.repo?.full_name === repository &&
    pullRequest?.head?.sha === releaseHead &&
    pullRequest?.merge_commit_sha === candidate &&
    pullRequest?.head?.ref === expectedHead &&
    pullRequest?.head?.repo?.full_name === repository &&
    pullRequest?.user?.login === "github-actions[bot]",
);
assert(
  eligible.length === 1,
  "Expected exactly one eligible merged Release Please pull request.",
);

const pullRequest = eligible[0];
assert(
  Number.isSafeInteger(pullRequest.number) && pullRequest.number > 0,
  "Release Please pull request number is invalid.",
);
const labels = new Set(
  (pullRequest.labels ?? []).map((label) => label?.name).filter(Boolean),
);
const pending = labels.has("autorelease: pending");
const tagged = labels.has("autorelease: tagged");
assert(pending !== tagged, "Release Please lifecycle labels are ambiguous.");

process.stdout.write(
  `${JSON.stringify({
    candidate,
    release_head: releaseHead,
    release_pr_number: pullRequest.number,
    pending,
    tagged,
    tag: `v${version}`,
    version,
  })}\n`,
);

function git(...arguments_) {
  return execFileSync("git", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function changed(from, to, file) {
  const result = spawnSync("git", ["diff", "--quiet", from, to, "--", file], {
    stdio: "ignore",
  });
  assert(
    result.status === 0 || result.status === 1,
    "Unable to inspect the candidate manifest change.",
  );
  return result.status === 1;
}

function stableVersion(version) {
  return (
    typeof version === "string" &&
    /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(version)
  );
}

function validBranch(branch) {
  return (
    typeof branch === "string" &&
    /^[A-Za-z0-9._/-]+$/.test(branch) &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("..") &&
    !branch.includes("//")
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
