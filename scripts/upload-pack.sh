#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'upload-pack: %s\n' "$*" >&2
	exit 1
}

repository=${GITHUB_REPOSITORY:-}
branch=main
control_commit=${RAN_RELEASE_CONTROL_COMMIT:-}
recovery_tuple=${RAN_RELEASE_RECOVERY:-}
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
	|| fail 'GITHUB_REPOSITORY is invalid.'
[[ -z "$control_commit" || "$control_commit" =~ ^[0-9a-f]{40}$ ]] \
	|| fail 'release control commit is invalid.'

validate_recovery() {
	local candidate=$1
	[[ "$recovery_tuple" == 31402080912:2 ]] \
		|| fail 'release recovery tuple is invalid.'
	[[ "$candidate" == b288b28cfd9c77f4b998c32427f77af045b0e68b ]] \
		|| fail 'release recovery candidate is invalid.'
	[[ $(git rev-parse HEAD) == "$control_commit" ]] \
		|| fail 'HEAD is not the release control commit.'
	[[ $(git rev-parse "${control_commit}^1") == 22b1a4341ace68b60be2b91c248deb3dc5073357 ]] \
		|| fail 'release control parent is invalid.'
	git merge-base --is-ancestor "$candidate" "$control_commit" \
		|| fail 'release candidate is not an ancestor of the control commit.'
	mapfile -t control_changes < <(git diff --name-only "$candidate" "$control_commit")
	[[ ${#control_changes[@]} -eq 5 \
		&& ${control_changes[0]} == .github/workflows/quality.yml \
		&& ${control_changes[1]} == .github/workflows/release-please.yml \
		&& ${control_changes[2]} == scripts/release-candidate.mjs \
		&& ${control_changes[3]} == scripts/upload-pack.sh \
		&& ${control_changes[4]} == tests/run.mjs ]] \
		|| fail 'release control changes exceed the recovery allowlist.'
}

release_json() {
	gh api "repos/${repository}/releases/tags/$1"
}

tag_json() {
	gh api "repos/${repository}/git/ref/tags/$1"
}

inspect_release() {
	local tag=$1 candidate=$2 prerelease=$3 response state release_id
	[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'release tag is invalid.'
	[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || fail 'release candidate is invalid.'
	[[ "$prerelease" == false ]] || fail 'template-pack releases must be stable.'
	[[ -z "$control_commit" ]] || validate_recovery "$candidate"

	if response=$(release_json "$tag" 2>&1); then
		jq -e \
			--arg tag "$tag" \
			--arg candidate "$candidate" \
			'.id | type == "number" and . > 0' <<< "$response" >/dev/null \
			|| fail 'release ID is invalid.'
		jq -e \
			--arg tag "$tag" \
			--arg candidate "$candidate" \
			'.tag_name == $tag and .target_commitish == $candidate and .prerelease == false' \
			<<< "$response" >/dev/null || fail 'release identity is invalid.'
		release_id=$(jq -er '.id' <<< "$response")
		if [[ $(jq -er '.draft' <<< "$response") == true ]]; then
			[[ $(jq -er '.immutable' <<< "$response") == false ]] \
				|| fail 'draft release is unexpectedly immutable.'
			state=draft
		else
			[[ $(jq -er '.immutable' <<< "$response") == true ]] \
				|| fail 'published release is not immutable.'
			state=published
		fi
	else
		[[ "$response" == *'HTTP 404'* ]] || {
			printf '%s\n' "$response" >&2
			fail 'release lookup failed.'
		}
		state=absent
		release_id=0
	fi

	if [[ "$state" == published ]]; then
		response=$(tag_json "$tag") || fail 'published tag is missing.'
		jq -e --arg candidate "$candidate" \
			'.object.type == "commit" and .object.sha == $candidate' \
			<<< "$response" >/dev/null || fail 'published tag target is invalid.'
	else
		local expected_main=${control_commit:-$candidate}
		[[ $(gh api "repos/${repository}/git/ref/heads/${branch}" --jq '.object.sha') == "$expected_main" ]] \
			|| fail 'default branch moved away from the candidate.'
		if response=$(tag_json "$tag" 2>&1); then
			fail 'tag exists before verified publication.'
		fi
		[[ "$response" == *'HTTP 404'* ]] || fail 'tag lookup failed.'
	fi

	jq -nc \
		--argjson release_id "$release_id" \
		--arg state "$state" \
		'{release_id: $release_id, state: $state}'
}

verify_asset() {
	local tag=$1 archive=$2 release_id=$3 candidate=$4 prerelease=$5 mode=$6
	local name size digest response state asset_count
	[[ -f "$archive" && ! -L "$archive" ]] || fail 'pack archive is invalid.'
	name=$(basename -- "$archive")
	[[ "$name" == ran-booster-release-bootstrap-templates.zip ]] \
		|| fail 'pack archive name is invalid.'
	[[ "$release_id" =~ ^[1-9][0-9]*$ ]] || fail 'release ID is invalid.'
	[[ "$mode" == pending || "$mode" == published ]] || fail 'release mode is invalid.'
	response=$(inspect_release "$tag" "$candidate" "$prerelease")
	state=$(jq -er '.state' <<< "$response")
	[[ $(jq -er '.release_id' <<< "$response") == "$release_id" ]] \
		|| fail 'release ID changed.'
	if [[ "$mode" == pending ]]; then
		[[ "$state" == draft ]] || fail 'pending asset mutation requires an exact draft.'
	else
		[[ "$state" == published ]] || fail 'published readback requires an immutable release.'
	fi

	size=$(wc -c < "$archive" | tr -d '[:space:]')
	digest="sha256:$(shasum -a 256 "$archive" | awk '{ print $1 }')"
	response=$(release_json "$tag")
	asset_count=$(jq -er '.assets | length' <<< "$response")
	if [[ "$asset_count" -eq 0 ]]; then
		[[ "$mode" == pending ]] || fail 'published release asset is missing.'
		gh release upload "$tag" "$archive" --repo "$repository"
	fi

	read -r -a readback_delays <<< "${RAN_RELEASE_READBACK_DELAYS:-0 2 2 2 2}"
	for delay in "${readback_delays[@]}"; do
		sleep "$delay"
		response=$(release_json "$tag")
		if jq -e \
			--arg digest "$digest" \
			--arg name "$name" \
			--argjson size "$size" \
			'.assets | length == 1 and .[0].id > 0
				and .[0].name == $name
				and .[0].size == $size
				and .[0].state == "uploaded"
				and .[0].content_type == "application/zip"
				and .[0].digest == $digest' \
			<<< "$response" >/dev/null; then
			break
		fi
	done
	jq -e \
		--arg digest "$digest" \
		--arg name "$name" \
		--argjson size "$size" \
		'.assets | length == 1 and .[0].id > 0
			and .[0].name == $name
			and .[0].size == $size
			and .[0].state == "uploaded"
			and .[0].content_type == "application/zip"
			and .[0].digest == $digest' \
		<<< "$response" >/dev/null || fail 'release asset metadata is invalid.'

	asset_temporary=$(mktemp -d)
	trap 'rm -rf "$asset_temporary"' EXIT HUP INT TERM
	gh release download "$tag" --repo "$repository" --pattern "$name" --dir "$asset_temporary"
	cmp -s "$archive" "$asset_temporary/$name" \
		|| fail 'downloaded pack differs from the verified local bytes.'
}

case ${1:-} in
	inspect)
		[[ $# -eq 4 ]] || fail 'expected inspect <tag> <candidate> <prerelease>.'
		inspect_release "$2" "$3" "$4"
		;;
	verify)
		[[ $# -eq 7 ]] \
			|| fail 'expected verify <tag> <archive> <release-id> <candidate> <prerelease> <pending|published>.'
		verify_asset "$2" "$3" "$4" "$5" "$6" "$7"
		;;
	*) fail 'expected inspect or verify command.' ;;
esac
