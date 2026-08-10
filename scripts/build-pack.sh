#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'build-pack: %s\n' "$*" >&2
	exit 1
}

project_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
output_dir=${1:-"$project_root/dist"}
repository_id=${2:-}
release_id=${3:-}
release_tag=${4:-}
release_ref=${5:-}
[[ -n "$release_ref" ]] || fail 'expected an explicit release commit.'
release_commit=$(git -C "$project_root" rev-parse --verify "$release_ref^{commit}") \
	|| fail 'release ref does not resolve to a commit.'
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'expected a full release commit SHA.'

temporary=$(mktemp -d "${TMPDIR:-/tmp}/ran-booster-template-pack.XXXXXX")
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
source_root="$temporary/source"
stage="$temporary/stage"
mkdir -p "$source_root" "$stage" "$output_dir"

entry_count=0
while IFS= read -r -d '' record; do
	metadata=${record%%$'\t'*}
	path=${record#*$'\t'}
	read -r mode type object <<< "$metadata"
	[[ "$path" =~ ^[A-Za-z0-9._/-]+$ && "$path" != /* && "$path" != *'..'* ]] \
		|| fail "committed pack input path is unsafe: $path"
	[[ "$type" == blob && ( "$mode" == 100644 || "$mode" == 100755 ) ]] \
		|| fail "committed pack input is not a regular blob: $path"
	[[ "$object" =~ ^[0-9a-f]{40,64}$ ]] \
		|| fail "committed pack input object is invalid: $path"
	entry_count=$((entry_count + 1))
done < <(
	git -C "$project_root" ls-tree -r -z --full-tree "$release_commit" -- \
		package.json profiles schema scripts src templates
)
[[ "$entry_count" -gt 0 ]] || fail 'release commit has no pack inputs.'

regular_blob_oid() {
	local file=$1 record metadata listed mode type object extra
	record=$(git -C "$project_root" ls-tree --full-tree "$release_commit" -- "$file") \
		|| fail "could not inspect required pack input: $file"
	[[ -n "$record" && "$record" == *$'\t'* ]] \
		|| fail "release commit is missing required pack input: $file"
	metadata=${record%%$'\t'*}
	listed=${record#*$'\t'}
	read -r mode type object extra <<< "$metadata"
	[[ "$listed" == "$file" && -z "${extra:-}" && "$type" == blob \
		&& ( "$mode" == 100644 || "$mode" == 100755 ) \
		&& "$object" =~ ^[0-9a-f]{40,64}$ ]] \
		|| fail "required pack input is not one regular blob: $file"
	printf '%s\n' "$object"
}

for required in \
	package.json \
	scripts/contract.mjs \
	scripts/generate-manifest.mjs \
	scripts/inspect-pack-archive.mjs \
	scripts/validate-pack.mjs \
	src/template-pack.source.json; do
	regular_blob_oid "$required" >/dev/null
done

git -C "$project_root" archive --format=tar "$release_commit" -- \
	package.json profiles schema scripts src templates \
	| tar -xf - -C "$source_root"

version=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.version || "")' "$source_root/package.json")
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || fail 'package version is invalid.'
[[ "$repository_id" =~ ^[1-9][0-9]*$ ]] || fail 'expected a positive repository ID.'
[[ "$release_id" =~ ^[1-9][0-9]*$ ]] || fail 'expected a positive release ID.'
[[ "$release_tag" == "v$version" ]] || fail 'release tag and package version differ.'
node "$source_root/scripts/generate-manifest.mjs" \
	"$stage" "$version" "$repository_id" "$release_id" "$release_tag" "$release_commit"
find "$stage" -type d -exec chmod 0755 {} +
find "$stage" -type f -exec chmod 0644 {} +
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
