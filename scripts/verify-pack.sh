#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'verify-pack: %s\n' "$*" >&2
	exit 1
}

project_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
version=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version || "")' "$project_root/package.json")
archive=${1:-"$project_root/dist/ran-booster-release-bootstrap-templates.zip"}
repository_id=${2:-}
release_id=${3:-}
release_tag=${4:-}
release_commit=${5:-}
[[ -f "$archive" && ! -L "$archive" ]] || fail 'template-pack ZIP is missing or symbolic.'
archive_size=$(wc -c < "$archive" | tr -d '[:space:]')
[[ "$archive_size" =~ ^[1-9][0-9]*$ && "$archive_size" -le 2097152 ]] \
	|| fail 'template-pack ZIP size is invalid.'
unzip -tqq "$archive" >/dev/null || fail 'template-pack ZIP is corrupt.'

temporary=$(mktemp -d "${TMPDIR:-/tmp}/ran-booster-template-verify.XXXXXX")
actual=$(mktemp)
expected=$(mktemp)
raw=$(mktemp)
trap 'rm -rf "$temporary"; rm -f "$actual" "$expected" "$raw"' EXIT HUP INT TERM

unzip -Z1 "$archive" > "$raw"
LC_ALL=C sort -u "$raw" > "$actual"
[[ "$(wc -l < "$raw" | tr -d '[:space:]')" == "$(wc -l < "$actual" | tr -d '[:space:]')" ]] \
	|| fail 'template-pack ZIP contains duplicate member names.'
if zipinfo -l "$archive" | awk '$1 ~ /^l/ { found = 1 } END { exit !found }'; then
	fail 'template-pack ZIP contains symbolic links.'
fi
if zipinfo -l "$archive" | awk '$1 ~ /^-/ && $1 ~ /x/ { found = 1 } END { exit !found }'; then
	fail 'template-pack ZIP contains executable members.'
fi

unzip -q "$archive" -d "$temporary"
declared=$(node "$project_root/scripts/validate-pack.mjs" \
	"$temporary" "$repository_id" "$release_id" "$release_tag" "$release_commit")
node -e 'for (const path of JSON.parse(process.argv[1])) console.log(path)' "$declared" \
	| LC_ALL=C sort -u > "$expected"
diff -u "$expected" "$actual" || fail 'template-pack ZIP has an unexpected member set.'
manifest_version=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.pack_version || "")' "$temporary/template-pack.json")
[[ "$manifest_version" == "$version" ]] || fail 'pack and package versions differ.'
archive_sha256=$(shasum -a 256 "$archive" | awk '{ print $1 }')
[[ "$archive_size" =~ ^[1-9][0-9]*$ && "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] \
	|| fail 'template-pack ZIP size or digest is invalid.'
printf 'Verified %s\nSHA-256 %s\n' "$archive" "$archive_sha256"
