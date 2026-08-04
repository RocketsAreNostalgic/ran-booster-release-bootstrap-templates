#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'upload-pack: %s\n' "$*" >&2
	exit 1
}

[[ $# -eq 2 ]] || fail 'expected <tag> <archive>.'
tag=$1
archive=$2
repository=${GITHUB_REPOSITORY:-}
name=$(basename -- "$archive")

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail 'release tag is invalid.'
[[ -f "$archive" && ! -L "$archive" ]] || fail 'pack archive is invalid.'
[[ "$name" == ran-booster-release-bootstrap-templates.zip ]] \
	|| fail 'pack archive name is invalid.'
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'GITHUB_REPOSITORY is invalid.'

assets=$(gh release view "$tag" --repo "$repository" --json assets --jq '.assets[].name')
asset_count=$(printf '%s\n' "$assets" | sed '/^$/d' | wc -l | tr -d '[:space:]')
expected_count=$(printf '%s\n' "$assets" | grep -Fxc "$name" || true)
if [[ "$expected_count" -eq 0 ]]; then
	[[ "$asset_count" -eq 0 ]] || fail 'draft release already contains another asset.'
	gh release upload "$tag" "$archive" --repo "$repository"
	expected_count=1
	asset_count=1
fi
[[ "$asset_count" -eq 1 && "$expected_count" -eq 1 ]] \
	|| fail 'draft release contains an ambiguous asset set.'

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT HUP INT TERM
gh release download "$tag" --repo "$repository" --pattern "$name" --dir "$temporary"
cmp -s "$archive" "$temporary/$name" || fail 'uploaded pack differs from the verified local bytes.'
