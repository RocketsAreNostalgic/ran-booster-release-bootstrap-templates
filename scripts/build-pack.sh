#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'build-pack: %s\n' "$*" >&2
	exit 1
}

project_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
version=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version || "")' "$project_root/package.json")
output_dir=${1:-"$project_root/dist"}
repository_id=${2:-}
release_id=${3:-}
release_tag=${4:-}
release_commit=${5:-}
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'package version is invalid.'
[[ "$repository_id" =~ ^[1-9][0-9]*$ ]] || fail 'expected a positive repository ID.'
[[ "$release_id" =~ ^[1-9][0-9]*$ ]] || fail 'expected a positive release ID.'
[[ "$release_tag" == "v$version" ]] || fail 'release tag and package version differ.'
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'expected a full release commit SHA.'

temporary=$(mktemp -d "${TMPDIR:-/tmp}/ran-booster-template-pack.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
stage="$temporary/stage"
mkdir -p "$stage" "$output_dir"
node "$project_root/scripts/generate-manifest.mjs" \
	"$stage" "$version" "$repository_id" "$release_id" "$release_tag" "$release_commit"
find "$stage" -exec touch -h -t 198001010000 {} +

output_dir=$(CDPATH='' cd -- "$output_dir" && pwd)
archive="$output_dir/ran-booster-release-bootstrap-templates.zip"
rm -f "$archive"
(
	cd "$stage"
	find template-pack.json templates -type f -print | LC_ALL=C sort | zip -DXq "$archive" -@
)
bash "$project_root/scripts/verify-pack.sh" \
	"$archive" "$repository_id" "$release_id" "$release_tag" "$release_commit"
printf '%s\n' "$archive"
