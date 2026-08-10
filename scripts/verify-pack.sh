#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'verify-pack: %s\n' "$*" >&2
	exit 1
}

project_root=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
archive=${1:-"$project_root/dist/ran-booster-release-bootstrap-templates.zip"}
repository_id=${2:-}
release_id=${3:-}
release_tag=${4:-}
release_ref=${5:-}
[[ -n "$release_ref" ]] || fail 'expected an explicit release commit.'
release_commit=$(git -C "$project_root" rev-parse --verify "$release_ref^{commit}") \
	|| fail 'release ref does not resolve to a commit.'
[[ "$release_commit" =~ ^[0-9a-f]{40}$ ]] || fail 'expected a full release commit SHA.'
[[ -f "$archive" && ! -L "$archive" ]] || fail 'template-pack ZIP is missing or symbolic.'
archive_size=$(wc -c < "$archive" | tr -d '[:space:]')
[[ "$archive_size" =~ ^[1-9][0-9]*$ && "$archive_size" -le 2097152 ]] \
	|| fail 'template-pack ZIP size is invalid.'

temporary=$(mktemp -d "${TMPDIR:-/tmp}/ran-booster-template-verify.XXXXXX")
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -rf "$temporary"; rm -f "$actual" "$expected"' EXIT HUP INT TERM
source_root="$temporary/source"
actual_root="$temporary/actual"
expected_root="$temporary/expected"
mkdir -p "$source_root" "$actual_root" "$expected_root"

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
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
	|| fail 'package version is invalid.'

node "$source_root/scripts/inspect-pack-archive.mjs" "$archive" \
	| LC_ALL=C sort > "$actual" \
	|| fail 'template-pack ZIP violates the structural archive contract.'
node "$source_root/scripts/generate-manifest.mjs" \
	"$expected_root" "$version" "$repository_id" "$release_id" "$release_tag" "$release_commit"
declared=$(node "$source_root/scripts/validate-pack.mjs" \
	"$expected_root" "$repository_id" "$release_id" "$release_tag" "$release_commit")
node -e 'for (const path of JSON.parse(process.argv[1])) console.log("F\t" + path)' "$declared" \
	| LC_ALL=C sort > "$expected"
diff -u "$expected" "$actual" || fail 'template-pack ZIP has an unexpected member set.'
unzip -tqq "$archive" >/dev/null || fail 'template-pack ZIP is corrupt.'
unzip -q "$archive" -d "$actual_root"
node "$source_root/scripts/validate-pack.mjs" \
	"$actual_root" "$repository_id" "$release_id" "$release_tag" "$release_commit" >/dev/null
while IFS=$'\t' read -r type member; do
	[[ "$type" == F ]] || fail "template-pack member type is invalid: $member"
	cmp -s "$expected_root/$member" "$actual_root/$member" \
		|| fail "template-pack member differs from the release commit: $member"
done < "$expected"
manifest_version=$(node -e 'const p=require(process.argv[1]); process.stdout.write(p.pack_version || "")' "$actual_root/template-pack.json")
[[ "$manifest_version" == "$version" ]] || fail 'pack and package versions differ.'
archive_sha256=$(shasum -a 256 "$archive" | awk '{ print $1 }')
[[ "$archive_size" =~ ^[1-9][0-9]*$ && "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] \
	|| fail 'template-pack ZIP size or digest is invalid.'
printf 'Verified %s\nSHA-256 %s\n' "$archive" "$archive_sha256"
