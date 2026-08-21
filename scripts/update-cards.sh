#!/usr/bin/env bash
# Refresh both profile instrument cards and push whatever changed.
#
#   scripts/update-cards.sh            # render, commit, push
#   PUSH=0 scripts/update-cards.sh     # render and commit only
#   DRY=1  scripts/update-cards.sh     # render only, leave git alone
#
# The languages card needs a token that can see private repositories.
# It uses GITHUB_TOKEN when set, otherwise falls back to `gh auth token`.
# The token graph needs ALMANAC_ORIGIN and ALMANAC_READ_TOKEN; when those are
# absent the card is left at its last rendered state instead of failing.
set -euo pipefail

cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

node --test scripts/render-languages.test.mjs >/dev/null
node --test scripts/render-token-graph.test.mjs >/dev/null
echo "tests pass"

node scripts/render-languages.mjs

if [ -n "${ALMANAC_ORIGIN:-}" ] && [ -n "${ALMANAC_READ_TOKEN:-}" ]; then
	node scripts/render-token-graph.mjs
else
	echo "skipping token graph: ALMANAC_ORIGIN / ALMANAC_READ_TOKEN not set"
fi

[ "${DRY:-0}" = "1" ] && { echo "dry run: nothing committed"; exit 0; }

if git diff --quiet -- README.md assets/; then
	echo "cards already current"
	exit 0
fi

git add README.md assets/
git commit -q -m "update profile cards ($(date -u +%Y-%m-%d))"
echo "committed"

[ "${PUSH:-1}" = "1" ] && git push -q && echo "pushed" || true
