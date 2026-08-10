import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  chmod,
  cp,
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadJson,
  profileFiles,
  root,
  templateTokens,
  validateSource,
} from "../scripts/contract.mjs";

const temporary = await mkdtemp(
  path.join(os.tmpdir(), "ran-booster-template-tests-"),
);
const { version } = await loadJson(path.join(root, "package.json"));
const identity = {
  repositoryId: "987654321",
  releaseId: "41",
  tag: `v${version}`,
};
const recoveryIdentity = {
  base: "f46329cefe4465d6dbf40204aed2d468b8a954c0",
  candidate: "4b4a340d238eada8e73f12745e3f929788cb8942",
  controlBase: "4b4a340d238eada8e73f12745e3f929788cb8942",
  releaseHead: "eee2dd42d5030750d0bbde51eb2a054a5a296979",
  tuple: "31417475890:2",
};
const recoveryControlFiles = [
  ".github/workflows/quality.yml",
  ".github/workflows/release-please.yml",
  "scripts/release-candidate.mjs",
  "scripts/upload-pack.sh",
  "tests/run.mjs",
];
const testCrcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1)
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

try {
  const schema = await loadJson(
    path.join(root, "schema/template-pack.schema.json"),
  );
  assert.equal(schema.properties.consumer_api.const, 2);
  assert.equal(schema.additionalProperties, false);

  const source = await loadJson(
    path.join(root, "src/template-pack.source.json"),
  );
  const profileDocuments = await Promise.all(
    profileFiles.map((file) => loadJson(path.join(root, file))),
  );
  const profiles = Object.fromEntries(
    profileDocuments.map(({ id, profile_version, entries }) => [
      id,
      { profile_version, entries },
    ]),
  );
  validateSource(source, profiles);
  await assertRepositoryWorkflows();
  await assertReleaseCandidateDecisions();
  await assertPublisherReleaseOutcomes();
  await renderFixtures(profiles);
  await assertDeterministicPack();
  await assertTamperFails();
  process.stdout.write("All Consumer API 2 template-pack tests passed.\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function assertRepositoryWorkflows() {
  const quality = await readFile(
    path.join(root, ".github/workflows/quality.yml"),
    "utf8",
  );
  const release = await readFile(
    path.join(root, ".github/workflows/release-please.yml"),
    "utf8",
  );
  const releaseCandidate = await readFile(
    path.join(root, "scripts/release-candidate.mjs"),
    "utf8",
  );

  for (const workflow of [quality, release]) {
    const actions = [...workflow.matchAll(/^\s+(?:- )?uses: (\S+)/gm)].map(
      (match) => match[1],
    );
    assert.ok(actions.length > 0);
    for (const action of actions)
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/, action);
  }

  assert.match(quality, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(quality, /git archive --format=tar/);
  assert.doesNotMatch(quality, /release-candidate/);
  assert.doesNotMatch(quality, /^\s+if:.*release-candidate/m);
  assert.match(quality, /candidate_commit: \$candidate_commit/);
  assert.match(release, /^\s+workflow_run:/m);
  assert.doesNotMatch(release, /^  workflow_dispatch:/m);
  assert.match(release, /actions\/runs\/\$\{RAN_QUALITY_RUN_ID\}/);
  assert.match(release, /\.workflow_id == 326857969/);
  assert.match(release, /\.name == "Quality"/);
  assert.match(release, /\.path == "\.github\/workflows\/quality\.yml"/);
  assert.match(release, /\.event == "push"/);
  assert.match(release, /\.conclusion == "success"/);
  assert.match(release, /workflow_run\.conclusion == 'success'/);
  assert.match(release, /workflow_run\.head_repository\.full_name/);
  assert.match(release, /steps\.quality\.outputs\.commit/);
  assert.match(release, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(release, /run-id: \$\{\{ steps\.quality\.outputs\.run_id \}\}/);
  assert.match(release, /RAN_QUALITY_RUN_ID" == 31417475890/);
  assert.match(release, /RAN_QUALITY_RUN_ATTEMPT" = 2/);
  assert.match(release, /4b4a340d238eada8e73f12745e3f929788cb8942/);
  assert.match(release, /RAN_RELEASE_RECOVERY/);
  assert.match(release, /steps\.quality\.outputs\.recovery != 'true'/);
  assert.match(release, /scripts\/release-candidate\.mjs/);
  assert.match(release, /printf 'PACK_COMMIT=%s/);
  assert.match(release, /"\$RAN_QUALITY_COMMIT"/);
  assert.match(release, /candidate_commit == \$candidate_commit/);
  assert.match(releaseCandidate, /base\?\.sha === baseCommit/);
  assert.match(release, /test "\$pending" = true/);
  for (const [field, expected] of [
    ["pending", "true"],
    ["tagged", "false"],
  ]) {
    const filter = release.match(
      new RegExp(`${field}="\\$\\(jq -r '([^']+)' <<< "\\$decision"\\)"`),
    )?.[1];
    assert.ok(filter, `${field} must use a false-safe typed jq reader.`);
    const readback = spawnSync("jq", ["-r", filter], {
      encoding: "utf8",
      input: JSON.stringify({ pending: true, tagged: false }),
    });
    assert.equal(readback.status, 0, readback.stderr);
    assert.equal(readback.stdout.trim(), expected);
  }
  assert.equal(
    (release.match(/bash scripts\/build-pack\.sh/g) ?? []).length,
    1,
  );
  assert.match(
    release,
    /git archive --format=tar --output="\$expected" "\$PACK_COMMIT"/,
  );
  assert.match(release, /cmp -s "\$inputs" "\$expected"/);
  assert.doesNotMatch(release, /^\s+publish-pack:/m);
}

async function assertReleaseCandidateDecisions() {
  const fixture = await createReleaseFixture("eligible");
  const pullRequest = eligiblePullRequest(fixture);
  const decision = runReleaseCandidate(fixture, [[pullRequest]]);
  assert.equal(decision.candidate, fixture.candidate);
  assert.equal(decision.release_head, fixture.releaseHead);
  assert.equal(decision.release_pr_number, 17);
  assert.equal(decision.pending, true);
  assert.equal(decision.tagged, false);
  assert.equal(decision.tag, "v0.3.0");
  const taggedDecision = runReleaseCandidate(fixture, [
    [{ ...pullRequest, labels: [{ name: "autorelease: tagged" }] }],
  ]);
  assert.equal(taggedDecision.pending, false);
  assert.equal(taggedDecision.tagged, true);

  const correctedChangelog = await createReleaseFixture("corrected-changelog", {
    postManifestPath: "CHANGELOG.md",
  });
  assert.equal(
    runReleaseCandidate(correctedChangelog, [
      eligiblePullRequest(correctedChangelog),
    ]).release_head,
    correctedChangelog.releaseHead,
  );
  const unsafePostManifest = await createReleaseFixture(
    "unsafe-post-manifest",
    { postManifestPath: "release-notes.txt" },
  );
  assert.notEqual(
    runReleaseCandidate(
      unsafePostManifest,
      [eligiblePullRequest(unsafePostManifest)],
      false,
    ).status,
    0,
    "A post-manifest payload change passed as a changelog correction.",
  );
  const lateManifestOwner = await createReleaseFixture("late-manifest-owner", {
    preManifestCommit: true,
  });
  assert.notEqual(
    runReleaseCandidate(
      lateManifestOwner,
      [eligiblePullRequest(lateManifestOwner)],
      false,
    ).status,
    0,
    "A manifest owner that was not the first child of the PR base passed.",
  );
  const manifestOwnerPayload = await createReleaseFixture(
    "manifest-owner-payload",
    { ownerExtraPath: "release-notes.txt" },
  );
  assert.notEqual(
    runReleaseCandidate(
      manifestOwnerPayload,
      [eligiblePullRequest(manifestOwnerPayload)],
      false,
    ).status,
    0,
    "A manifest owner with an extra release payload path passed.",
  );

  const rejectedPullRequests = [
    ["missing", []],
    ["ambiguous", [[pullRequest], [{ ...pullRequest, number: 18 }]]],
    [
      "wrong base",
      [{ ...pullRequest, base: { ...pullRequest.base, ref: "develop" } }],
    ],
    [
      "wrong base SHA",
      [
        {
          ...pullRequest,
          base: { ...pullRequest.base, sha: "e".repeat(40) },
        },
      ],
    ],
    [
      "wrong head",
      [{ ...pullRequest, head: { ...pullRequest.head, sha: fixture.base } }],
    ],
    ["wrong merge", [{ ...pullRequest, merge_commit_sha: fixture.base }]],
    [
      "wrong repository",
      [
        {
          ...pullRequest,
          head: {
            ...pullRequest.head,
            repo: { full_name: "attacker/fork" },
          },
        },
      ],
    ],
    ["wrong author", [{ ...pullRequest, user: { login: "untrusted-user" } }]],
    ["unmerged", [{ ...pullRequest, merged_at: null }]],
    ["missing lifecycle", [{ ...pullRequest, labels: [] }]],
    [
      "conflicting lifecycle",
      [
        {
          ...pullRequest,
          labels: [
            { name: "autorelease: pending" },
            { name: "autorelease: tagged" },
          ],
        },
      ],
    ],
  ];
  for (const [label, pullRequests] of rejectedPullRequests) {
    const result = runReleaseCandidate(fixture, pullRequests, false);
    assert.notEqual(result.status, 0, `${label} candidate evidence passed.`);
  }

  const oneParent = { ...fixture, candidate: fixture.releaseHead };
  git(fixture.directory, "checkout", "--detach", fixture.releaseHead);
  assert.notEqual(
    runReleaseCandidate(oneParent, [pullRequest], false).status,
    0,
    "A one-parent release head passed as the green merge candidate.",
  );

  const differentTree = await createReleaseFixture("different-tree", {
    differentTree: true,
  });
  assert.notEqual(
    runReleaseCandidate(
      differentTree,
      [eligiblePullRequest(differentTree)],
      false,
    ).status,
    0,
    "A merge with bytes absent from the Release Please head passed.",
  );

  const noManifest = await createReleaseFixture("no-manifest", {
    changeManifest: false,
  });
  assert.notEqual(
    runReleaseCandidate(noManifest, [eligiblePullRequest(noManifest)], false)
      .status,
    0,
    "A merge without a Release Please manifest change passed.",
  );

  const recovery = await createOneShotRecoveryFixture("candidate");
  const recovered = runReleaseCandidate(
    recovery,
    [eligiblePullRequest(recovery)],
    true,
    {
      RAN_RELEASE_CONTROL_COMMIT: recovery.controlCommit,
      RAN_RELEASE_RECOVERY: recoveryIdentity.tuple,
    },
  );
  assert.equal(recovered.candidate, recovery.candidate);
  assert.notEqual(
    runReleaseCandidate(recovery, [eligiblePullRequest(recovery)], false, {
      RAN_RELEASE_CONTROL_COMMIT: recovery.controlCommit,
    }).status,
    0,
    "Recovery accepted a missing one-shot tuple.",
  );
  for (const [label, unsafeRecovery] of [
    [
      "extra recovery path",
      await createOneShotRecoveryFixture("candidate-extra", {
        extraPath: true,
      }),
    ],
    [
      "wrong recovery parent",
      await createOneShotRecoveryFixture("candidate-parent", {
        secondCommit: true,
      }),
    ],
    [
      "merge-only recovery payload",
      await createOneShotRecoveryFixture("candidate-merge-payload", {
        mergePayload: true,
      }),
    ],
  ]) {
    assert.notEqual(
      runReleaseCandidate(
        unsafeRecovery,
        [eligiblePullRequest(unsafeRecovery)],
        false,
        {
          RAN_RELEASE_CONTROL_COMMIT: unsafeRecovery.controlCommit,
          RAN_RELEASE_RECOVERY: recoveryIdentity.tuple,
        },
      ).status,
      0,
      `${label} passed release-candidate recovery.`,
    );
  }
}

async function createReleaseFixture(
  name,
  {
    changeManifest = true,
    differentTree = false,
    ownerExtraPath = "",
    postManifestPath = "",
    preManifestCommit = false,
  } = {},
) {
  const directory = path.join(temporary, `release-candidate-${name}`);
  const expectedHead =
    "release-please--branches--main--components--ran-booster-release-bootstrap-templates";
  await mkdir(directory, { recursive: true });
  git(directory, "init", "-b", "main");
  git(directory, "config", "user.email", "fixture@example.test");
  git(directory, "config", "user.name", "Fixture");
  await writeFile(
    path.join(directory, "package.json"),
    `${JSON.stringify({ version: "0.2.0" })}\n`,
  );
  await writeFile(
    path.join(directory, ".release-please-manifest.json"),
    `${JSON.stringify({ ".": "0.2.0" })}\n`,
  );
  await writeFile(path.join(directory, "CHANGELOG.md"), "# Changelog\n");
  git(directory, "add", ".");
  git(directory, "commit", "-m", "chore: fixture base");
  git(directory, "checkout", "-b", expectedHead);
  if (preManifestCommit) {
    await writeFile(
      path.join(directory, "CHANGELOG.md"),
      "Release preparation.\n\n# Changelog\n",
    );
    git(directory, "add", "CHANGELOG.md");
    git(directory, "commit", "-m", "docs: prepare release notes");
  }
  if (changeManifest) {
    await writeFile(
      path.join(directory, "package.json"),
      `${JSON.stringify({ version: "0.3.0" })}\n`,
    );
    await writeFile(
      path.join(directory, ".release-please-manifest.json"),
      `${JSON.stringify({ ".": "0.3.0" })}\n`,
    );
    await writeFile(
      path.join(directory, "CHANGELOG.md"),
      "## 0.3.0\n\nRelease fixture.\n\n# Changelog\n",
    );
    if (ownerExtraPath) {
      await writeFile(path.join(directory, ownerExtraPath), "Unexpected.\n");
    }
  } else {
    await writeFile(path.join(directory, "release-notes.txt"), "No version.\n");
  }
  git(directory, "add", ".");
  git(directory, "commit", "-m", "chore(main): release fixture");
  if (postManifestPath) {
    await writeFile(
      path.join(directory, postManifestPath),
      "Audited release correction.\n",
    );
    git(directory, "add", postManifestPath);
    git(directory, "commit", "-m", "docs: correct release notes");
  }
  const releaseHead = git(directory, "rev-parse", "HEAD");

  git(directory, "checkout", "main");
  if (differentTree) {
    await writeFile(path.join(directory, "main-only.txt"), "main movement\n");
    git(directory, "add", "main-only.txt");
    git(directory, "commit", "-m", "fix: concurrent main change");
  }
  git(directory, "merge", "--no-ff", expectedHead, "-m", "Merge release PR");
  const candidate = git(directory, "rev-parse", "HEAD");
  return {
    base: git(directory, "rev-parse", `${candidate}^1`),
    candidate,
    directory,
    expectedHead,
    releaseHead,
  };
}

async function createOneShotRecoveryFixture(
  name,
  { extraPath = false, mergePayload = false, secondCommit = false } = {},
) {
  const directory = path.join(temporary, `release-recovery-${name}`);
  git(temporary, "clone", "--quiet", "--no-hardlinks", root, directory);
  git(directory, "config", "user.email", "fixture@example.test");
  git(directory, "config", "user.name", "Fixture");
  git(
    directory,
    "checkout",
    "-B",
    "recovery-base",
    recoveryIdentity.controlBase,
  );
  git(directory, "checkout", "-b", "recovery-correction");
  for (const file of recoveryControlFiles) {
    const destination = path.join(directory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(root, file), destination);
  }
  if (extraPath)
    await writeFile(path.join(directory, "payload.txt"), "changed\n");
  git(directory, "add", ".");
  git(directory, "commit", "-m", "fix: recover corrected release candidate");
  git(directory, "checkout", "recovery-base");
  if (secondCommit)
    git(directory, "commit", "--allow-empty", "-m", "fix: move recovery base");
  git(directory, "merge", "--no-ff", "--no-commit", "recovery-correction");
  if (mergePayload) {
    await writeFile(
      path.join(directory, "tests/run.mjs"),
      "merge-only payload\n",
    );
    git(directory, "add", "tests/run.mjs");
  }
  git(directory, "commit", "-m", "Merge recovery correction");
  return {
    base: recoveryIdentity.base,
    candidate: recoveryIdentity.candidate,
    controlCommit: git(directory, "rev-parse", "HEAD"),
    directory,
    expectedHead:
      "release-please--branches--main--components--ran-booster-release-bootstrap-templates",
    releaseHead: recoveryIdentity.releaseHead,
  };
}

function eligiblePullRequest(fixture) {
  return {
    number: 17,
    merged_at: "2026-08-10T10:00:00Z",
    base: {
      ref: "main",
      sha: fixture.base,
      repo: {
        full_name:
          "RocketsAreNostalgic/ran-booster-release-bootstrap-templates",
      },
    },
    head: {
      ref: fixture.expectedHead,
      repo: {
        full_name:
          "RocketsAreNostalgic/ran-booster-release-bootstrap-templates",
      },
      sha: fixture.releaseHead,
    },
    labels: [{ name: "autorelease: pending" }],
    merge_commit_sha: fixture.candidate,
    user: { login: "github-actions[bot]" },
  };
}

function runReleaseCandidate(
  fixture,
  pullRequests,
  successful = true,
  environment = {},
) {
  const pullRequestsFile = path.join(fixture.directory, "pull-requests.json");
  writeFileSync(pullRequestsFile, JSON.stringify(pullRequests));
  const arguments_ = [
    path.join(root, "scripts/release-candidate.mjs"),
    fixture.candidate,
    "RocketsAreNostalgic/ran-booster-release-bootstrap-templates",
    "main",
    fixture.expectedHead,
    pullRequestsFile,
  ];
  if (!successful)
    return spawnSync(process.execPath, arguments_, {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    });
  return JSON.parse(
    execFileSync(process.execPath, arguments_, {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}

function git(directory, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function assertPublisherReleaseOutcomes() {
  const harness = path.join(temporary, "publisher-harness");
  const bin = path.join(harness, "bin");
  await mkdir(bin, { recursive: true });
  const fakeGh = path.join(bin, "gh");
  await writeFile(
    fakeGh,
    `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, "tests/fake-gh.mjs")}" "$@"\n`,
  );
  await chmod(fakeGh, 0o755);

  const recovery = await createOneShotRecoveryFixture("publisher");
  const recoveryPublisher = {
    archive: "ran-booster-release-bootstrap-templates.zip",
    branchEnvironment: {
      RAN_RELEASE_CONTROL_COMMIT: recovery.controlCommit,
      RAN_RELEASE_RECOVERY: recoveryIdentity.tuple,
    },
    prerelease: false,
    script: path.join(root, "scripts/upload-pack.sh"),
    tag: "v0.2.1",
  };
  const recoveryInspect = [
    "inspect",
    recoveryPublisher.tag,
    recoveryIdentity.candidate,
    "false",
  ];
  const recoveryState = {
    branch_sha: recovery.controlCommit,
    calls: [],
    release: null,
    remote_asset: path.join(recovery.directory, "remote.zip"),
    tag: null,
  };
  const recovered = runPublisher(
    recoveryPublisher,
    recoveryInspect,
    recoveryState,
    bin,
    recovery.directory,
  );
  assert.equal(JSON.parse(recovered.stdout).state, "absent");
  assertPublisherFails(
    recoveryPublisher,
    ["inspect", recoveryPublisher.tag, "a".repeat(40), "false"],
    recoveryState,
    bin,
    recovery.directory,
    "wrong recovery candidate",
  );
  assertPublisherFails(
    {
      ...recoveryPublisher,
      branchEnvironment: {
        ...recoveryPublisher.branchEnvironment,
        RAN_RELEASE_RECOVERY: "31417475890:3",
      },
    },
    recoveryInspect,
    recoveryState,
    bin,
    recovery.directory,
    "wrong recovery tuple",
  );
  for (const [label, unsafeRecovery] of [
    [
      "extra recovery path",
      await createOneShotRecoveryFixture("publisher-extra", {
        extraPath: true,
      }),
    ],
    [
      "wrong recovery parent",
      await createOneShotRecoveryFixture("publisher-parent", {
        secondCommit: true,
      }),
    ],
    [
      "merge-only recovery payload",
      await createOneShotRecoveryFixture("publisher-merge-payload", {
        mergePayload: true,
      }),
    ],
  ]) {
    assertPublisherFails(
      {
        ...recoveryPublisher,
        branchEnvironment: {
          ...recoveryPublisher.branchEnvironment,
          RAN_RELEASE_CONTROL_COMMIT: unsafeRecovery.controlCommit,
        },
      },
      recoveryInspect,
      { ...recoveryState, branch_sha: unsafeRecovery.controlCommit },
      bin,
      unsafeRecovery.directory,
      label,
    );
  }

  const publishers = [
    {
      archive: "ran-booster-release-bootstrap-templates.zip",
      branchEnvironment: {},
      prerelease: false,
      script: path.join(root, "scripts/upload-pack.sh"),
      tag: "v0.3.0",
    },
    {
      archive: "example-package-1.2.3-beta.1.zip",
      branchEnvironment: { RAN_RELEASE_BRANCH: "main" },
      prerelease: true,
      script: path.join(root, "templates/shared/upload-release-assets.sh.tmpl"),
      tag: "v1.2.3-beta.1",
    },
  ];

  for (const [publisherIndex, publisher] of publishers.entries()) {
    const publisherRoot = path.join(harness, `publisher-${publisherIndex}`);
    await mkdir(publisherRoot, { recursive: true });
    const archive = path.join(publisherRoot, publisher.archive);
    const remote = path.join(publisherRoot, "remote.zip");
    const candidate = "1234567890abcdef1234567890abcdef12345678";
    await writeFile(archive, `candidate-${publisherIndex}\n`);
    const archiveBytes = await readFile(archive);
    const asset = releaseAsset(publisher.archive, archiveBytes);
    const base = {
      branch_sha: candidate,
      calls: [],
      release: null,
      remote_asset: remote,
      tag: null,
    };
    const release = releaseRecord({
      assets: [],
      candidate,
      prerelease: publisher.prerelease,
      tag: publisher.tag,
    });
    const inspect = [
      "inspect",
      publisher.tag,
      candidate,
      String(publisher.prerelease),
    ];
    const verify = (mode) => [
      "verify",
      publisher.tag,
      archive,
      "41",
      candidate,
      String(publisher.prerelease),
      mode,
    ];

    const absent = runPublisher(publisher, inspect, base, bin, publisherRoot);
    assert.equal(JSON.parse(absent.stdout).state, "absent");
    assertPublisherFails(
      publisher,
      inspect,
      { ...base, branch_sha: "a".repeat(40) },
      bin,
      publisherRoot,
      "main movement",
    );
    assertPublisherFails(
      publisher,
      inspect,
      { ...base, tag: { sha: candidate } },
      bin,
      publisherRoot,
      "preexisting tag",
    );

    const exactDraft = { ...base, release };
    const draft = runPublisher(
      publisher,
      inspect,
      exactDraft,
      bin,
      publisherRoot,
    );
    assert.equal(JSON.parse(draft.stdout).state, "draft");
    assertPublisherFails(
      publisher,
      inspect,
      {
        ...base,
        release_pages: [[release], [{ ...release, id: 42 }]],
      },
      bin,
      publisherRoot,
      "duplicate paginated drafts",
    );
    assertPublisherFails(
      publisher,
      inspect,
      {
        ...base,
        release: { ...release, draft: false, immutable: true },
        release_tag_404: true,
        tag: { sha: candidate },
      },
      bin,
      publisherRoot,
      "published release missing tag lookup",
    );
    assertPublisherFails(
      publisher,
      inspect,
      { ...base, release_tag_error: true },
      bin,
      publisherRoot,
      "non-404 release lookup failure",
    );
    for (const [label, invalidRelease] of [
      ["wrong target", { ...release, target_commitish: "b".repeat(40) }],
      ["wrong release ID", { ...release, id: 0 }],
      ["wrong prerelease", { ...release, prerelease: !publisher.prerelease }],
      ["mutable publication", { ...release, draft: false, immutable: false }],
    ]) {
      assertPublisherFails(
        publisher,
        inspect,
        { ...base, release: invalidRelease },
        bin,
        publisherRoot,
        label,
      );
    }

    const pending = runPublisher(
      publisher,
      verify("pending"),
      exactDraft,
      bin,
      publisherRoot,
    );
    assert.deepEqual(pending.state.calls, ["upload", "download"]);
    assert.deepEqual(pending.state.release.assets, [asset]);

    await writeFile(remote, archiveBytes);
    const exactAssetDraft = {
      ...base,
      release: { ...release, assets: [asset] },
    };
    const draftRetry = runPublisher(
      publisher,
      verify("pending"),
      exactAssetDraft,
      bin,
      publisherRoot,
    );
    assert.deepEqual(draftRetry.state.calls, ["download"]);

    const publishedRelease = {
      ...release,
      assets: [asset],
      draft: false,
      immutable: true,
    };
    const lostAcknowledgement = {
      ...base,
      branch_sha: "c".repeat(40),
      release: publishedRelease,
      tag: { sha: candidate },
    };
    const published = runPublisher(
      publisher,
      verify("published"),
      lostAcknowledgement,
      bin,
      publisherRoot,
    );
    assert.deepEqual(published.state.calls, ["download"]);
    assert.equal(published.state.calls.includes("upload"), false);

    for (const [label, invalidAssets] of [
      ["missing asset", []],
      ["extra asset", [asset, { ...asset, id: 902, name: "extra.zip" }]],
      ["wrong asset name", [{ ...asset, name: "wrong.zip" }]],
      ["wrong asset size", [{ ...asset, size: asset.size + 1 }]],
      ["wrong asset state", [{ ...asset, state: "new" }]],
      [
        "wrong asset digest",
        [{ ...asset, digest: `sha256:${"0".repeat(64)}` }],
      ],
    ]) {
      assertPublisherFails(
        publisher,
        verify("published"),
        {
          ...lostAcknowledgement,
          release: { ...publishedRelease, assets: invalidAssets },
        },
        bin,
        publisherRoot,
        label,
      );
    }
    assertPublisherFails(
      publisher,
      inspect,
      {
        ...lostAcknowledgement,
        tag: { sha: "d".repeat(40) },
      },
      bin,
      publisherRoot,
      "wrong published tag target",
    );

    await writeFile(remote, "different bytes\n");
    assertPublisherFails(
      publisher,
      verify("published"),
      lostAcknowledgement,
      bin,
      publisherRoot,
      "mismatched downloaded bytes",
    );
  }
}

function runPublisher(publisher, arguments_, state, bin, directory) {
  const stateFile = path.join(directory, "fake-gh-state.json");
  writeFileSync(stateFile, `${JSON.stringify(structuredClone(state))}\n`);
  const result = spawnSync("bash", [publisher.script, ...arguments_], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      ...publisher.branchEnvironment,
      GITHUB_REPOSITORY:
        "RocketsAreNostalgic/ran-booster-release-bootstrap-templates",
      PATH: `${bin}:${process.env.PATH}`,
      RAN_FAKE_GH_STATE: stateFile,
      RAN_RELEASE_READBACK_DELAYS: "0",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    ...result,
    state: JSON.parse(readFileSync(stateFile, "utf8")),
  };
}

function assertPublisherFails(
  publisher,
  arguments_,
  state,
  bin,
  directory,
  label,
) {
  const stateFile = path.join(directory, `fake-gh-state-${label}.json`);
  writeFileSync(stateFile, `${JSON.stringify(structuredClone(state))}\n`);
  const result = spawnSync("bash", [publisher.script, ...arguments_], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      ...publisher.branchEnvironment,
      GITHUB_REPOSITORY:
        "RocketsAreNostalgic/ran-booster-release-bootstrap-templates",
      PATH: `${bin}:${process.env.PATH}`,
      RAN_FAKE_GH_STATE: stateFile,
      RAN_RELEASE_READBACK_DELAYS: "0",
    },
  });
  assert.notEqual(result.status, 0, `${label} unexpectedly passed.`);
  const finalState = JSON.parse(readFileSync(stateFile, "utf8"));
  assert.equal(
    finalState.calls.includes("upload"),
    false,
    `${label} performed an unsafe upload.`,
  );
}

function releaseRecord({ assets, candidate, prerelease, tag }) {
  return {
    id: 41,
    tag_name: tag,
    target_commitish: candidate,
    draft: true,
    immutable: false,
    prerelease,
    assets,
  };
}

function releaseAsset(name, bytes) {
  return {
    id: 901,
    name,
    size: bytes.length,
    state: "uploaded",
    content_type: "application/zip",
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}

async function renderFixtures(profiles) {
  const baseValues = await loadJson(
    path.join(root, "tests/fixtures/render-values.json"),
  );
  for (const [profileId, profile] of Object.entries(profiles)) {
    const fixtureRoot = path.join(temporary, profileId.replaceAll("/", "-"));
    await mkdir(fixtureRoot, { recursive: true });
    const values = {
      ...baseValues,
      EXTRA_FILES_JSON: profileId.includes("theme")
        ? '[{"type":"generic","path":"style.css"}]'
        : baseValues.EXTRA_FILES_JSON,
      HEADER_PATH: profileId.includes("theme")
        ? "style.css"
        : "example-package.php",
      PACKAGE_TYPE: profileId.includes("theme") ? "theme" : "plugin",
    };

    for (const [logicalId, entry] of Object.entries(profile.entries)) {
      const template = await readFile(path.join(root, entry.path), "utf8");
      let rendered = template;
      for (const token of [...new Set(templateTokens(template))]) {
        assert.ok(
          Object.hasOwn(values, token),
          `Fixture has no value for ${token}`,
        );
        rendered = rendered.split(`{{RAN_${token}}}`).join(values[token]);
      }
      assert.deepEqual(
        templateTokens(rendered),
        [],
        `Unrendered placeholder in ${logicalId}`,
      );
      const destination = path.join(fixtureRoot, fixtureName(logicalId));
      await writeFile(destination, rendered, "utf8");
      if (destination.endsWith(".json")) {
        const config = JSON.parse(rendered);
        assert.deepEqual(Object.keys(config.packages["."]["extra-files"][0]), [
          "type",
          "path",
        ]);
        assert.equal(config.packages["."]["prerelease"], undefined);
      }
      if (destination.endsWith(".sh"))
        execFileSync("bash", ["-n", destination], { stdio: "pipe" });
      if (destination.endsWith(".yml")) validateManagedWorkflow(rendered);
    }
    await assertRenderedCommitArchive(fixtureRoot, values);
  }
}

async function assertRenderedCommitArchive(renderedRoot, values) {
  const fixture = path.join(
    temporary,
    `rendered-commit-${values.PACKAGE_TYPE}`,
  );
  const scripts = path.join(fixture, "scripts");
  const source = path.join(fixture, "src");
  const cleanOutput = path.join(fixture, "clean-output");
  const dirtyOutput = path.join(fixture, "dirty-output");
  const changedOutput = path.join(fixture, "changed-output");
  const releaseVersion = "1.2.3";
  await mkdir(scripts, { recursive: true });
  await mkdir(source, { recursive: true });
  await cp(
    path.join(renderedRoot, "build-release.sh"),
    path.join(scripts, "build-release.sh"),
  );
  await cp(
    path.join(renderedRoot, "verify-release.sh"),
    path.join(scripts, "verify-release.sh"),
  );
  await chmod(path.join(scripts, "build-release.sh"), 0o755);
  await chmod(path.join(scripts, "verify-release.sh"), 0o755);
  await writeFile(
    path.join(fixture, ".release-please-manifest.json"),
    `${JSON.stringify({ ".": releaseVersion })}\n`,
  );
  await writeFile(path.join(fixture, "version.txt"), `${releaseVersion}\n`);
  await writeFile(
    path.join(fixture, "release-contents.txt"),
    `src/\n${values.HEADER_PATH}\nREADME.md\n`,
  );
  await writeFile(path.join(fixture, "README.md"), "Fixture package.\n");
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// committed runtime\n",
  );
  const header =
    values.PACKAGE_TYPE === "plugin"
      ? `<?php\n/**\n * Plugin Name: Fixture package\n * Version: ${releaseVersion}\n * Update URI: ${values.UPDATE_URI}\n */\n`
      : `/*\nTheme Name: Fixture package\nVersion: ${releaseVersion}\nUpdate URI: ${values.UPDATE_URI}\n*/\n`;
  await writeFile(path.join(fixture, values.HEADER_PATH), header);

  git(fixture, "init", "-b", "main");
  git(fixture, "config", "user.email", "fixture@example.test");
  git(fixture, "config", "user.name", "Fixture");
  git(fixture, "add", ".");
  git(fixture, "commit", "-m", "chore: exact source fixture");
  const commit = git(fixture, "rev-parse", "HEAD");
  const build = path.join(scripts, "build-release.sh");
  const verify = path.join(scripts, "verify-release.sh");

  runBashWithUmask(
    build,
    [commit, releaseVersion, cleanOutput],
    fixture,
    "022",
  );
  const archiveName = `${values.PACKAGE_SLUG}-${releaseVersion}.zip`;
  const cleanArchive = path.join(cleanOutput, archiveName);
  const cleanBytes = await readFile(cleanArchive);
  if (values.PACKAGE_TYPE === "plugin") {
    await assertHostileArchiveMatrix({
      label: "rendered release",
      cleanArchive,
      archiveBytes: 50 * 1024 * 1024,
      members: 10000,
      memberBytes: 127826407,
      totalBytes: 127826407,
      runVerify: (candidate, environment) =>
        spawnSync("bash", [verify, candidate, releaseVersion, commit], {
          cwd: fixture,
          encoding: "utf8",
          env: { ...process.env, ...environment },
        }),
    });
  }

  await writeFile(path.join(fixture, "release-contents.txt"), "../unsafe\n");
  await writeFile(
    path.join(fixture, values.HEADER_PATH),
    header.replace(releaseVersion, "9.9.9"),
  );
  await writeFile(path.join(fixture, "version.txt"), "9.9.9\n");
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// dirty runtime\n",
  );
  await writeFile(path.join(source, "untracked.php"), "<?php\n// untracked\n");
  runBashWithUmask(
    build,
    [commit, releaseVersion, dirtyOutput],
    fixture,
    "077",
  );
  const dirtyArchive = path.join(dirtyOutput, archiveName);
  assert.ok(
    cleanBytes.equals(await readFile(dirtyArchive)),
    `${values.PACKAGE_TYPE} archive changed under dirty tracked or untracked files.`,
  );
  execFileSync("bash", [verify, cleanArchive, releaseVersion, commit], {
    cwd: fixture,
    stdio: "pipe",
  });
  assert.notEqual(
    spawnSync("bash", [build, "", releaseVersion, dirtyOutput], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered builder accepted an omitted release commit.",
  );

  git(fixture, "restore", ".");
  await rm(path.join(source, "untracked.php"));
  await writeFile(
    path.join(source, "Runtime.php"),
    "<?php\n// next committed runtime\n",
  );
  git(fixture, "add", "src/Runtime.php");
  git(fixture, "commit", "-m", "fix: change committed runtime");
  const changedCommit = git(fixture, "rev-parse", "HEAD");
  execFileSync("bash", [build, changedCommit, releaseVersion, changedOutput], {
    cwd: fixture,
    stdio: "pipe",
  });
  assert.equal(
    cleanBytes.equals(await readFile(path.join(changedOutput, archiveName))),
    false,
    `${values.PACKAGE_TYPE} archive ignored changed committed bytes.`,
  );
  assert.notEqual(
    spawnSync("bash", [verify, cleanArchive, releaseVersion, changedCommit], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered verifier accepted an archive from a different commit.",
  );

  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "missing allowlist entry",
    allowlist: "missing-file.php\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "unsafe allowlist entry",
    allowlist: "../unsafe\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "duplicate allowlist entry",
    allowlist: "src/\nsrc\n",
  });
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "overlapping projection",
    allowlist: "src/\nsrc/Runtime.php\n",
  });
  const symlink = path.join(fixture, "linked-runtime.php");
  await writeFile(path.join(fixture, "link-target.php"), "<?php\n");
  execFileSync("ln", ["-s", "link-target.php", symlink]);
  await assertRejectedCommittedProjection(fixture, build, releaseVersion, {
    label: "symbolic source",
    allowlist: "linked-runtime.php\n",
    add: ["linked-runtime.php", "link-target.php"],
  });

  git(fixture, "rm", "-f", "linked-runtime.php", "link-target.php");
  git(fixture, "commit", "-m", "test: remove symbolic source fixture");
  const gitlinkTarget = git(fixture, "rev-parse", "HEAD");
  git(
    fixture,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${gitlinkTarget},linked-module`,
  );
  await writeFile(
    path.join(fixture, "release-contents.txt"),
    "linked-module\n",
  );
  git(fixture, "add", "release-contents.txt");
  git(fixture, "commit", "-m", "test: committed gitlink fixture");
  const gitlinkCommit = git(fixture, "rev-parse", "HEAD");
  assert.notEqual(
    spawnSync("bash", [build, gitlinkCommit, releaseVersion, changedOutput], {
      cwd: fixture,
      encoding: "utf8",
    }).status,
    0,
    "Rendered builder accepted a committed gitlink.",
  );
}

async function assertRejectedCommittedProjection(
  fixture,
  build,
  releaseVersion,
  { label, allowlist, add = [] },
) {
  await writeFile(path.join(fixture, "release-contents.txt"), allowlist);
  git(fixture, "add", "release-contents.txt", ...add);
  git(fixture, "commit", "-m", `test: ${label}`);
  const commit = git(fixture, "rev-parse", "HEAD");
  const result = spawnSync(
    "bash",
    [build, commit, releaseVersion, path.join(fixture, `rejected-${commit}`)],
    { cwd: fixture, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0, `Rendered builder accepted ${label}.`);
}

function fixtureName(logicalId) {
  if (logicalId === "release-workflow") return "release-please.yml";
  if (logicalId === "release-please-config")
    return "release-please-config.json";
  if (logicalId === "build-release-script") return "build-release.sh";
  if (logicalId === "verify-release-script") return "verify-release.sh";
  if (logicalId === "upload-release-assets-script")
    return "upload-release-assets.sh";
  throw new Error(`Unknown fixture logical ID: ${logicalId}`);
}

function validateManagedWorkflow(workflow) {
  assert.match(workflow, /^on:\n  push:\n    branches:/m);
  assert.match(workflow, /^  workflow_run:\n    workflows:\n      - Quality/m);
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /googleapis\/release-please-action@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /github\.event_name == 'workflow_run'/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_repository\.full_name/);
  assert.match(
    workflow,
    /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/,
  );
  assert.match(workflow, /\.merge_commit_sha == \$candidate/);
  assert.match(workflow, /\.base\.sha == \$base/);
  assert.match(workflow, /\.head\.sha == \$release_head/);
  assert.match(workflow, /--target "\$RAN_RELEASE_COMMIT"/);
  assert.match(workflow, /upload-release-assets\.sh verify/);
  assert.match(workflow, /^            published$/m);
  assert.match(workflow, /\.ran-booster-release-dist/);
  assert.doesNotMatch(workflow, /^    needs: release-please$/m);
  assert.doesNotMatch(workflow, /Consumer API 1/);
  assert.doesNotMatch(workflow, /rm -rf build/);
  assert.doesNotMatch(workflow, /uses: [^\n]+@(main|master|v\d+)\s*$/m);
}

async function assertDeterministicPack() {
  const sourceFixture = path.join(temporary, "pack-source");
  await mkdir(sourceFixture);
  for (const entry of [
    "package.json",
    "profiles",
    "schema",
    "scripts",
    "src",
    "templates",
  ]) {
    await cp(path.join(root, entry), path.join(sourceFixture, entry), {
      recursive: true,
    });
  }
  git(sourceFixture, "init", "-b", "main");
  git(sourceFixture, "config", "user.email", "fixture@example.test");
  git(sourceFixture, "config", "user.name", "Fixture");
  git(sourceFixture, "add", ".");
  git(sourceFixture, "commit", "-m", "chore: exact pack source");
  const commit = git(sourceFixture, "rev-parse", "HEAD");
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  await mkdir(first);
  await mkdir(second);
  const arguments_ = [
    identity.repositoryId,
    identity.releaseId,
    identity.tag,
    commit,
  ];
  runBashWithUmask(
    path.join(sourceFixture, "scripts/build-pack.sh"),
    [first, ...arguments_],
    sourceFixture,
    "022",
  );
  await writeFile(
    path.join(sourceFixture, "package.json"),
    `${JSON.stringify({ name: "dirty", version: "9.9.9" })}\n`,
  );
  await writeFile(
    path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
    "dirty template\n",
  );
  await writeFile(
    path.join(sourceFixture, "src/template-pack.source.json"),
    "{}\n",
  );
  await writeFile(
    path.join(sourceFixture, "profiles/source-ready-wordpress-plugin-2.json"),
    "{}\n",
  );
  await writeFile(
    path.join(sourceFixture, "templates/shared/untracked-looking.tmpl"),
    "untracked template\n",
  );
  runBashWithUmask(
    path.join(sourceFixture, "scripts/build-pack.sh"),
    [second, ...arguments_],
    sourceFixture,
    "077",
  );
  const archiveName = "ran-booster-release-bootstrap-templates.zip";
  const one = await readFile(path.join(first, archiveName));
  const two = await readFile(path.join(second, archiveName));
  assert.ok(
    one.equals(two),
    "Pack builds are not byte-for-byte deterministic.",
  );
  await assertHostileArchiveMatrix({
    label: "template pack",
    cleanArchive: path.join(first, archiveName),
    archiveBytes: 2 * 1024 * 1024,
    members: 32,
    memberBytes: 256 * 1024,
    totalBytes: 1024 * 1024,
    runVerify: (candidate, environment) =>
      spawnSync(
        "bash",
        [
          path.join(sourceFixture, "scripts/verify-pack.sh"),
          candidate,
          ...arguments_,
        ],
        {
          cwd: sourceFixture,
          encoding: "utf8",
          env: { ...process.env, ...environment },
        },
      ),
  });
  execFileSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/verify-pack.sh"),
      path.join(first, archiveName),
      ...arguments_,
    ],
    { cwd: sourceFixture, stdio: "pipe" },
  );
  const missing = spawnSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/build-pack.sh"),
      path.join(temporary, "missing-pack"),
      identity.repositoryId,
      identity.releaseId,
      identity.tag,
      "f".repeat(40),
    ],
    { cwd: sourceFixture, encoding: "utf8" },
  );
  assert.notEqual(
    missing.status,
    0,
    "Pack builder accepted an unavailable commit.",
  );

  const members = execFileSync(
    "unzip",
    ["-Z1", path.join(first, archiveName)],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.equal(members.includes("template-pack.json"), true);
  assert.equal(
    members.some((member) => member.endsWith("/")),
    false,
  );
  assert.equal(members.includes("release-contents.txt"), false);

  git(sourceFixture, "restore", ".");
  await rm(path.join(sourceFixture, "templates/shared/untracked-looking.tmpl"));
  await writeFile(
    path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
    `${await readFile(
      path.join(sourceFixture, "templates/shared/build-release.sh.tmpl"),
      "utf8",
    )}\n# next committed template bytes\n`,
  );
  git(sourceFixture, "add", "templates/shared/build-release.sh.tmpl");
  git(sourceFixture, "commit", "-m", "fix: change committed pack input");
  const changedCommit = git(sourceFixture, "rev-parse", "HEAD");
  const changedArguments = [
    identity.repositoryId,
    identity.releaseId,
    identity.tag,
    changedCommit,
  ];
  const changedOutput = path.join(temporary, "changed-pack");
  execFileSync(
    "bash",
    [
      path.join(sourceFixture, "scripts/build-pack.sh"),
      changedOutput,
      ...changedArguments,
    ],
    { cwd: sourceFixture, stdio: "pipe" },
  );
  assert.equal(
    one.equals(await readFile(path.join(changedOutput, archiveName))),
    false,
    "Pack archive ignored changed committed template bytes.",
  );
  assert.notEqual(
    spawnSync(
      "bash",
      [
        path.join(sourceFixture, "scripts/verify-pack.sh"),
        path.join(first, archiveName),
        ...changedArguments,
      ],
      { cwd: sourceFixture, encoding: "utf8" },
    ).status,
    0,
    "Pack verifier accepted an archive from a different commit.",
  );

  await rm(path.join(sourceFixture, "scripts/contract.mjs"));
  await mkdir(path.join(sourceFixture, "scripts/contract.mjs"));
  await writeFile(
    path.join(sourceFixture, "scripts/contract.mjs/nested.mjs"),
    "export default {};\n",
  );
  git(sourceFixture, "add", "-A");
  git(sourceFixture, "commit", "-m", "test: required pack input as tree");
  const nonBlobCommit = git(sourceFixture, "rev-parse", "HEAD");
  assert.notEqual(
    spawnSync(
      "bash",
      [
        path.join(sourceFixture, "scripts/build-pack.sh"),
        path.join(temporary, "non-blob-pack"),
        identity.repositoryId,
        identity.releaseId,
        identity.tag,
        nonBlobCommit,
      ],
      { cwd: sourceFixture, encoding: "utf8" },
    ).status,
    0,
    "Pack builder accepted a required control path as a tree.",
  );
}

async function assertTamperFails() {
  const extracted = path.join(temporary, "tampered");
  const archive = path.join(
    temporary,
    "first/ran-booster-release-bootstrap-templates.zip",
  );
  await mkdir(extracted);
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  const target = path.join(
    extracted,
    "templates/shared/upload-release-assets.sh.tmpl",
  );
  await writeFile(
    target,
    `${await readFile(target, "utf8")}# tampered\n`,
    "utf8",
  );
  const result = spawnSync(
    "node",
    [path.join(root, "scripts/validate-pack.mjs"), extracted],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.notEqual(
    result.status,
    0,
    "A modified template passed digest verification.",
  );
  assert.match(result.stderr, /digest mismatch|size mismatch/i);
}

function runBashWithUmask(script, arguments_, cwd, mask) {
  execFileSync(
    "bash",
    [
      "-c",
      'umask "$1"; shift; exec "$@"',
      "exact-commit-fixture",
      mask,
      "bash",
      script,
      ...arguments_,
    ],
    { cwd, stdio: "pipe" },
  );
}

async function assertHostileArchiveMatrix({
  label,
  cleanArchive,
  archiveBytes,
  members,
  memberBytes,
  totalBytes,
  runVerify,
}) {
  const fixture = path.join(temporary, `hostile-${label.replaceAll(" ", "-")}`);
  const bin = path.join(fixture, "bin");
  const marker = path.join(fixture, "unzip-called");
  await mkdir(bin, { recursive: true });
  const fakeUnzip = path.join(bin, "unzip");
  await writeFile(
    fakeUnzip,
    '#!/usr/bin/env bash\nprintf "called\\n" > "$RAN_UNZIP_MARKER"\nexit 97\n',
  );
  await chmod(fakeUnzip, 0o755);
  const environment = {
    PATH: `${bin}:${process.env.PATH}`,
    RAN_UNZIP_MARKER: marker,
  };
  const sourceEntries = archiveEntries(cleanArchive);
  const firstFile = sourceEntries.find((entry) => !entry.name.endsWith("/"));
  assert.ok(firstFile, `${label} has no regular fixture member.`);
  const unsafe = "unsafe/member.php";
  const budgetCompressed = (size) => Math.max(1, Math.ceil(size / 199));
  const totalEntryCount = Math.floor(totalBytes / memberBytes) + 2;
  const totalEntrySize = Math.floor(totalBytes / (totalEntryCount - 1)) + 1;
  const hostileCases = [
    ["duplicate raw member", "duplicate_member", [firstFile, firstFile]],
    [
      "case-normalized collision",
      "normalized_collision",
      [firstFile, { ...firstFile, name: firstFile.name.toUpperCase() }],
    ],
    [
      "file-directory collision",
      "normalized_collision",
      [firstFile, archiveMember(`${firstFile.name}/`, "", 0o040755)],
    ],
    [
      "file-parent hierarchy",
      "member_hierarchy",
      [archiveMember("parent"), archiveMember("parent/child.php")],
    ],
    ["absolute path", "member_path", [archiveMember("/absolute.php")]],
    ["drive path", "member_path", [archiveMember("C:/drive.php")]],
    ["backslash path", "member_path", [archiveMember("bad\\path.php")]],
    ["traversal path", "member_path", [archiveMember("../escape.php")]],
    ["dot segment", "member_path", [archiveMember("bad/./path.php")]],
    ["empty segment", "member_path", [archiveMember("bad//path.php")]],
    ["trailing dot", "member_path", [archiveMember("bad./path.php")]],
    ["trailing space", "member_path", [archiveMember("bad /path.php")]],
    ["control character", "member_path", [archiveMember("bad\npath.php")]],
    ["reserved device", "member_path", [archiveMember("CON/file.php")]],
    ["non-ASCII path", "member_path", [archiveMember("café.php")]],
    [
      "invalid UTF-8 path",
      "name_encoding",
      [
        {
          ...archiveMember("invalid.php"),
          nameBytes: Buffer.from([0xff]),
          localNameBytes: Buffer.from([0xff]),
        },
      ],
    ],
    [
      "overlong segment",
      "member_path",
      [archiveMember(`${"a".repeat(256)}.php`)],
    ],
    [
      "symbolic link",
      "member_type",
      [archiveMember(unsafe, "target", 0o120777)],
    ],
    ["FIFO", "member_type", [archiveMember(unsafe, "", 0o010644)]],
    ["socket", "member_type", [archiveMember(unsafe, "", 0o140644)]],
    ["device", "member_type", [archiveMember(unsafe, "", 0o060644)]],
    ["executable", "member_executable", [archiveMember(unsafe, "x", 0o100755)]],
    ["non-Unix host", "member_type", [{ ...archiveMember(unsafe), host: 0 }]],
    [
      "encrypted",
      "unsupported_member",
      [{ ...archiveMember(unsafe), flags: 1 }],
    ],
    [
      "data descriptor",
      "unsupported_member",
      [{ ...archiveMember(unsafe), flags: 8 }],
    ],
    [
      "unsupported compression",
      "unsupported_member",
      [{ ...archiveMember(unsafe), method: 12 }],
    ],
    [
      "ZIP extra",
      "directory_record",
      [{ ...archiveMember(unsafe), centralExtra: Buffer.from([1, 0, 0, 0]) }],
    ],
    [
      "central comment",
      "directory_record",
      [{ ...archiveMember(unsafe), centralComment: Buffer.from("comment") }],
    ],
    [
      "local extra",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localExtra: Buffer.from([1, 0, 0, 0]) }],
    ],
    [
      "central disk start",
      "directory_record",
      [{ ...archiveMember(unsafe), diskStart: 1 }],
    ],
    [
      "ZIP64 version",
      "directory_record",
      [{ ...archiveMember(unsafe), needed: 45 }],
    ],
    [
      "ZIP64 entry count",
      "multidisk_or_zip64",
      [archiveMember(unsafe)],
      { entryCount: 0xffff },
    ],
    [
      "EOCD comment",
      "directory_missing",
      [archiveMember(unsafe)],
      { eocdComment: Buffer.from("comment") },
    ],
    [
      "trailing data",
      "directory_missing",
      [archiveMember(unsafe)],
      { trailing: Buffer.from("trailing") },
    ],
    [
      "member budget",
      "member_budget",
      [
        {
          ...archiveMember(unsafe),
          compressedSize: budgetCompressed(memberBytes + 1),
          uncompressedSize: memberBytes + 1,
        },
      ],
    ],
    [
      "ratio budget",
      "member_budget",
      [
        {
          ...archiveMember(unsafe),
          compressedSize: 1,
          uncompressedSize: 201,
        },
      ],
    ],
    [
      "total budget",
      "total_budget",
      Array.from({ length: totalEntryCount }, (_, index) => ({
        ...archiveMember(`total-${index}.php`),
        compressedSize: budgetCompressed(totalEntrySize),
        uncompressedSize: totalEntrySize,
      })),
    ],
    [
      "member-count budget",
      "directory_bounds",
      [archiveMember(unsafe)],
      { entryCount: members + 1 },
    ],
    [
      "local name mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localName: "other/member.php" }],
    ],
    [
      "local flags mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localFlags: 0x0800 }],
    ],
    [
      "local method mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localMethod: 8 }],
    ],
    [
      "local CRC mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localCrc: 1 }],
    ],
    [
      "local size mismatch",
      "local_mismatch",
      [{ ...archiveMember(unsafe), localUncompressedSize: 2 }],
    ],
    [
      "overlapping local records",
      "local_bounds",
      [
        archiveMember("one.php"),
        { ...archiveMember("two.php"), localOffset: 0 },
      ],
    ],
    [
      "incorrect CRC",
      "member_integrity",
      [{ ...archiveMember(unsafe), crc: 1, localCrc: 1 }],
    ],
    [
      "expanded size mismatch",
      "member_integrity",
      [
        {
          ...archiveMember(unsafe),
          uncompressedSize: 2,
          localUncompressedSize: 2,
        },
      ],
    ],
    [
      "corrupt deflate stream",
      "member_decompression",
      [{ ...archiveMember(unsafe, "not-deflate"), method: 8 }],
    ],
    [
      "directory payload",
      "directory_payload",
      [archiveMember("payload/", "x", 0o040755)],
    ],
    [
      "unexpected member",
      "unexpected",
      [...sourceEntries, archiveMember("unexpected-member.txt")],
    ],
  ];

  for (const [caseName, code, entries, options = {}] of hostileCases) {
    const candidate = path.join(
      fixture,
      `${caseName.replaceAll(/[^A-Za-z0-9]+/g, "-")}.zip`,
    );
    await writeFile(candidate, makeZip(entries, options));
    await rm(marker, { force: true });
    const result = runVerify(candidate, environment);
    assert.notEqual(result.status, 0, `${label} accepted ${caseName}.`);
    if (code === "unexpected")
      assert.match(
        result.stderr,
        /unexpected member set|committed runtime allowlist/i,
      );
    else
      assert.match(
        result.stderr,
        new RegExp(code, "i"),
        `${label}: ${caseName}`,
      );
    await assert.rejects(
      readFile(marker),
      undefined,
      `${label} extracted ${caseName}.`,
    );
  }

  const oversized = path.join(fixture, "oversized.zip");
  const handle = await open(oversized, "w");
  await handle.truncate(archiveBytes + 1);
  await handle.close();
  await rm(marker, { force: true });
  const result = runVerify(oversized, environment);
  assert.notEqual(result.status, 0, `${label} accepted an oversized archive.`);
  assert.match(result.stderr, /archive_size|ZIP size is invalid/i);
  await assert.rejects(
    readFile(marker),
    undefined,
    `${label} extracted an oversized archive.`,
  );
}

function archiveEntries(archive) {
  const names = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .trim()
    .split("\n");
  return names.map((name) =>
    archiveMember(
      name,
      name.endsWith("/")
        ? Buffer.alloc(0)
        : execFileSync("unzip", ["-p", archive, name]),
      name.endsWith("/") ? 0o040755 : 0o100644,
    ),
  );
}

function archiveMember(name, contents = "x", mode = 0o100644) {
  return {
    name,
    contents: Buffer.isBuffer(contents) ? contents : Buffer.from(contents),
    mode,
  };
}

function makeZip(entries, options = {}) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = entry.nameBytes ?? Buffer.from(entry.name);
    const localName =
      entry.localNameBytes ?? Buffer.from(entry.localName ?? entry.name);
    const contents = entry.contents;
    const crc = entry.crc ?? testCrc32(contents);
    const compressedSize = entry.compressedSize ?? contents.length;
    const uncompressedSize = entry.uncompressedSize ?? contents.length;
    const flags = entry.flags ?? 0;
    const method = entry.method ?? 0;
    const localExtra = entry.localExtra ?? Buffer.alloc(0);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0);
    const centralComment = entry.centralComment ?? Buffer.alloc(0);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(entry.localNeeded ?? entry.needed ?? 20, 4);
    localHeader.writeUInt16LE(entry.localFlags ?? flags, 6);
    localHeader.writeUInt16LE(entry.localMethod ?? method, 8);
    localHeader.writeUInt32LE(entry.localCrc ?? crc, 14);
    localHeader.writeUInt32LE(entry.localCompressedSize ?? compressedSize, 18);
    localHeader.writeUInt32LE(
      entry.localUncompressedSize ?? uncompressedSize,
      22,
    );
    localHeader.writeUInt16LE(localName.length, 26);
    localHeader.writeUInt16LE(localExtra.length, 28);
    const localRecord = Buffer.concat([
      localHeader,
      localName,
      localExtra,
      contents,
    ]);
    local.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(((entry.host ?? 3) << 8) | 20, 4);
    centralHeader.writeUInt16LE(entry.needed ?? 20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt16LE(centralComment.length, 32);
    centralHeader.writeUInt16LE(entry.diskStart ?? 0, 34);
    const dosDirectory = entry.name.endsWith("/") ? 0x10 : 0;
    centralHeader.writeUInt32LE(
      (((entry.mode << 16) >>> 0) | dosDirectory) >>> 0,
      38,
    );
    centralHeader.writeUInt32LE(entry.localOffset ?? offset, 42);
    central.push(
      Buffer.concat([centralHeader, name, centralExtra, centralComment]),
    );
    offset += localRecord.length;
  }
  const centralBytes = Buffer.concat(central);
  const eocdComment = options.eocdComment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22);
  const entryCount = options.entryCount ?? entries.length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.disk ?? 0, 4);
  eocd.writeUInt16LE(options.centralDisk ?? 0, 6);
  eocd.writeUInt16LE(options.diskEntries ?? entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(eocdComment.length, 20);
  return Buffer.concat([
    ...local,
    centralBytes,
    eocd,
    eocdComment,
    options.trailing ?? Buffer.alloc(0),
  ]);
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes)
    crc = testCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
