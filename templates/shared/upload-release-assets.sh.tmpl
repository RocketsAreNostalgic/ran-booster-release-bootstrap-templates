#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'upload-release-assets: %s\n' "$*" >&2
	exit 1
}

[[ $# -eq 2 ]] || fail 'expected <tag> <zip>.'
tag=$1
archive=$2
repository=${GITHUB_REPOSITORY:-}
name=$(basename -- "$archive")

[[ "$tag" =~ ^v[0-9A-Za-z][0-9A-Za-z.-]*$ ]] || fail 'release tag is invalid.'
[[ -f "$archive" && "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$ ]] \
	|| fail 'release ZIP is invalid.'
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
	|| fail 'GITHUB_REPOSITORY is invalid.'

assets=$(gh release view "$tag" --repo "$repository" --json assets --jq '.assets[].name')
zip_count=0
expected_count=0
while IFS= read -r asset; do
	[[ -n "$asset" ]] || continue
	if [[ "$asset" == *.zip ]]; then
		zip_count=$((zip_count + 1))
		[[ "$asset" == "$name" ]] && expected_count=$((expected_count + 1))
	fi
done <<< "$assets"

if [[ $expected_count -eq 0 ]]; then
	[[ $zip_count -eq 0 ]] || fail 'release already contains a different ZIP.'
	gh release upload "$tag" "$archive" --repo "$repository"
	expected_count=1
	zip_count=1
fi
[[ $expected_count -eq 1 && $zip_count -eq 1 ]] \
	|| fail 'release contains ambiguous ZIP assets.'

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
gh release download "$tag" --repo "$repository" --pattern "$name" --dir "$temporary"
cmp -s "$archive" "$temporary/$name" \
	|| fail 'an existing release ZIP has different bytes.'
