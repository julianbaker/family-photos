#!/bin/sh
# Merge a new Immich release into the fork, file by file, so the result is exactly
# "the release + the fork's changes" and nothing else.
#
#   family/upgrade/upgrade.sh v3.5.0
#
# Why not a plain `git merge`: Immich cuts releases on release branches, so a merge also brings in
# old release-branch hotfixes that the new release dropped. Those merge in silently, even into files
# the fork touched. This script rebuilds every file from the refs instead:
#
#   - files only the fork has (its own folders, Family migrations): the fork's version
#   - files the fork changed (the diff between family/UPSTREAM_BASE and `family`): the release's version
#     with the fork's own changes applied on top (three-way); failures are left for you
#   - generated files (OpenAPI spec, SDK, SQL query files): the release's version; regenerate after
#   - the migration ORDER file: both lists, in timestamp order
#   - every other file: exactly the release's version
#
# It works on a new branch `upgrade/<release>` and never touches `family` itself.
set -eu
TARGET="${1:?the release tag to merge, e.g. v3.5.0}"
cd "$(git rev-parse --show-toplevel)"
BASE=$(cat family/UPSTREAM_BASE)
FORK=family

git diff --quiet && git diff --cached --quiet || { echo "Commit or stash your changes first."; exit 1; }
git rev-parse --verify -q "$TARGET^{commit}" >/dev/null || { echo "Unknown release $TARGET (git fetch upstream --tags)"; exit 1; }

echo "Merging $TARGET into a copy of $FORK (fork changes measured from $BASE)"
git checkout -q -b "upgrade/$TARGET" "$FORK"
git merge --no-ff --no-commit "$TARGET" >/dev/null 2>&1 || true

GENERATED="open-api/immich-openapi-specs.json packages/sdk/src/fetch-client.ts mobile/openapi"
ORDER=server/src/schema/migrations/ORDER
manual=""

exists_in() { git cat-file -e "$1:$2" 2>/dev/null; }
is_generated() {
  case "$1" in server/src/queries/*.sql) return 0 ;; esac
  for path in $GENERATED; do case "$1" in "$path"|"$path"/*) return 0 ;; esac; done
  return 1
}
take() { # take <ref> <file>
  if exists_in "$1" "$2"; then git checkout -q "$1" -- "$2"; else git rm -q -f --ignore-unmatch -- "$2"; fi
}

files=$( { git diff --name-only "$TARGET"; git diff --name-only --diff-filter=U; git diff --name-only "$BASE" "$FORK" --; } | sort -u )
for file in $files; do
  if [ "$file" = "$ORDER" ]; then
    { git show "$TARGET:$ORDER"; git show "$FORK:$ORDER"; } | sort -u -t- -k1,1n > "$ORDER"
    git add "$ORDER"
  elif is_generated "$file"; then
    take "$TARGET" "$file"
  elif ! exists_in "$BASE" "$file" && exists_in "$FORK" "$file" && ! exists_in "$TARGET" "$file"; then
    take "$FORK" "$file" # the fork's own file
  elif exists_in "$BASE" "$file" && ! git diff --quiet "$BASE" "$FORK" -- "$file"; then
    # the fork changed this upstream file: the release's version plus the fork's changes
    take "$TARGET" "$file"
    if git diff "$BASE" "$FORK" -- "$file" | git apply --3way --index >/dev/null 2>&1; then
      :
    else
      manual="$manual $file"
    fi
  elif exists_in "$FORK" "$file" && exists_in "$TARGET" "$file" && ! exists_in "$BASE" "$file" \
    && ! git diff --quiet "$FORK" "$TARGET" -- "$file"; then
    manual="$manual $file" # both added it (e.g. AGENTS.md): combine by hand
  else
    take "$TARGET" "$file"
  fi
done

echo
if [ -n "$manual" ]; then
  echo "Resolve these by hand (the release's version plus the fork's change), then git add:"
  for file in $manual; do echo "  $file"; done
else
  echo "Every file resolved."
fi
echo
echo "Next: family/upgrade.md, from 'Check' on."
