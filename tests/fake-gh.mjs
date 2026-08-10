#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const stateFile = process.env.RAN_FAKE_GH_STATE;
if (!stateFile) fail("RAN_FAKE_GH_STATE is required.");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const arguments_ = process.argv.slice(2);
const releases = state.releases ?? (state.release ? [state.release] : []);

if (arguments_[0] === "api") {
  const endpoint = arguments_
    .slice(1)
    .find((argument) => !argument.startsWith("-"));
  const jqIndex = arguments_.indexOf("--jq");
  let response;
  if (endpoint?.includes("/git/ref/heads/")) {
    response = { object: { sha: state.branch_sha, type: "commit" } };
  } else if (endpoint?.includes("/git/ref/tags/")) {
    if (!state.tag) notFound();
    response = { object: { sha: state.tag.sha, type: "commit" } };
  } else if (endpoint?.includes("/releases/tags/")) {
    if (state.release_tag_error) fail("HTTP 500: release lookup failed");
    if (state.release_tag_404) notFound();
    const requestedTag = endpoint.split("/releases/tags/")[1];
    const matches = releases.filter(
      (release) => !release.draft && release.tag_name === requestedTag,
    );
    if (matches.length !== 1) notFound();
    response = matches[0];
  } else if (endpoint?.includes("/releases?")) {
    if ((state.release_inventory_lag ?? 0) > 0) {
      state.release_inventory_lag -= 1;
      response = [];
      save();
    } else {
      response = state.release_pages ?? releases;
    }
  } else if (/\/releases\/[1-9][0-9]*$/.test(endpoint ?? "")) {
    const releaseId = Number(endpoint.split("/releases/")[1]);
    response = releases.find((release) => release.id === releaseId);
    if (!response) notFound();
  } else {
    fail(`Unsupported API endpoint: ${endpoint}`);
  }
  if (arguments_.includes("--slurp")) {
    process.stdout.write(
      `${JSON.stringify(state.release_pages ? response : [response])}\n`,
    );
  } else if (jqIndex >= 0 && arguments_[jqIndex + 1] === ".object.sha") {
    process.stdout.write(`${response.object.sha}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
  process.exit(0);
}

if (arguments_[0] === "release" && arguments_[1] === "upload") {
  if (!state.release) fail("Cannot upload without a release.");
  const archive = arguments_[3];
  const bytes = readFileSync(archive);
  const name = path.basename(archive);
  const remote = state.remote_asset;
  copyFileSync(archive, remote);
  state.release.assets = [
    {
      id: 901,
      name,
      size: bytes.length,
      state: "uploaded",
      content_type: "application/zip",
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    },
  ];
  state.calls.push("upload");
  save();
  process.exit(0);
}

if (arguments_[0] === "release" && arguments_[1] === "download") {
  const directory = option("--dir");
  const pattern = option("--pattern");
  if (!state.remote_asset) fail("Remote asset is unavailable.");
  mkdirSync(directory, { recursive: true });
  copyFileSync(state.remote_asset, path.join(directory, pattern));
  state.calls.push("download");
  save();
  process.exit(0);
}

fail(`Unsupported gh command: ${arguments_.join(" ")}`);

function option(name) {
  const index = arguments_.indexOf(name);
  if (index < 0 || !arguments_[index + 1]) fail(`Missing ${name}.`);
  return arguments_[index + 1];
}

function notFound() {
  process.stderr.write("HTTP 404: Not Found\n");
  process.exit(1);
}

function save() {
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
