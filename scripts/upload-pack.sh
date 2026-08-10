#!/usr/bin/env bash
set -euo pipefail

fail() {
	printf 'upload-pack: %s\n' "$*" >&2
	exit 1
}

repository=${GITHUB_REPOSITORY:-}
branch=main
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
	|| fail 'GITHUB_REPOSITORY is invalid.'

release_json() {
	local tag=$1 response inventory count
	if response=$(gh api "repos/${repository}/releases/tags/${tag}" 2>&1); then
		printf '%s\n' "$response"
		return 0
	fi
	[[ "$response" == *'HTTP 404'* ]] || {
		printf '%s\n' "$response" >&2
		fail 'release tag lookup failed.'
	}
	if ! inventory=$(gh api --paginate --slurp \
		"repos/${repository}/releases?per_page=100" 2>&1); then
		printf '%s\n' "$inventory" >&2
		fail 'release inventory lookup failed.'
	fi
	count=$(jq -er --arg tag "$tag" \
		'[.[][] | select(.tag_name == $tag)] | length' <<< "$inventory")
	case $count in
		0)
			printf 'release lookup: HTTP 404\n' >&2
			return 1
			;;
		1)
			response=$(jq -cer --arg tag "$tag" \
				'[.[][] | select(.tag_name == $tag)][0]' <<< "$inventory")
			[[ $(jq -er '.draft' <<< "$response") == true ]] \
				|| fail 'published release is missing from the tag lookup.'
			printf '%s\n' "$response"
			;;
		*) fail 'release inventory contains duplicate tag identities.' ;;
	esac
}

release_id_json() {
	[[ "$1" =~ ^[1-9][0-9]*$ ]] || fail 'release ID is invalid.'
	gh api "repos/${repository}/releases/$1"
}

tag_json() {
	gh api "repos/${repository}/git/ref/tags/$1"
}

inspect_release() {
	local tag=$1 candidate=$2 prerelease=$3 response state release_id
	[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'release tag is invalid.'
	[[ "$candidate" =~ ^[0-9a-f]{40}$ ]] || fail 'release candidate is invalid.'
	[[ "$prerelease" == false ]] || fail 'template-pack releases must be stable.'

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
		[[ $(gh api "repos/${repository}/git/ref/heads/${branch}" --jq '.object.sha') == "$candidate" ]] \
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

inspect_created_release() {
	local tag=$1 candidate=$2 prerelease=$3 response state
	local -a discovery_delays
	read -r -a discovery_delays <<< "${RAN_RELEASE_DISCOVERY_DELAYS:-0 2 2 2 2}"
	[[ ${#discovery_delays[@]} -gt 0 ]] || fail 'release discovery delays are empty.'
	for delay in "${discovery_delays[@]}"; do
		sleep "$delay"
		response=$(inspect_release "$tag" "$candidate" "$prerelease") \
			|| fail 'created release lookup failed.'
		state=$(jq -er '.state' <<< "$response")
		if [[ "$state" == draft ]]; then
			printf '%s\n' "$response"
			return 0
		fi
		[[ "$state" == absent ]] || fail 'created release is not an exact draft.'
	done
	fail 'created draft did not become visible within the bounded readback window.'
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
	if [[ "$mode" == pending ]]; then
		response=$(release_id_json "$release_id")
	else
		response=$(release_json "$tag")
	fi
	asset_count=$(jq -er '.assets | length' <<< "$response")
	if [[ "$asset_count" -eq 0 ]]; then
		[[ "$mode" == pending ]] || fail 'published release asset is missing.'
		gh release upload "$tag" "$archive" --repo "$repository"
	fi

	read -r -a readback_delays <<< "${RAN_RELEASE_READBACK_DELAYS:-0 2 2 2 2}"
	for delay in "${readback_delays[@]}"; do
		sleep "$delay"
		if [[ "$mode" == pending ]]; then
			response=$(release_id_json "$release_id")
		else
			response=$(release_json "$tag")
		fi
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
	inspect-created)
		[[ $# -eq 4 ]] || fail 'expected inspect-created <tag> <candidate> <prerelease>.'
		inspect_created_release "$2" "$3" "$4"
		;;
	verify)
		[[ $# -eq 7 ]] \
			|| fail 'expected verify <tag> <archive> <release-id> <candidate> <prerelease> <pending|published>.'
		verify_asset "$2" "$3" "$4" "$5" "$6" "$7"
		;;
	*) fail 'expected inspect, inspect-created, or verify command.' ;;
esac
