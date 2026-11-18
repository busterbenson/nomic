#!/usr/bin/env bash
# Create a game with a fresh random join code and print the join link.
# The code is generated here, at setup time, and never committed (the repo is
# public). Usage:
#   scripts/create-game.sh                 # local D1
#   scripts/create-game.sh --remote        # the deployed D1 (run by whoever deploys)
# Optional env: GAME_NAME, MAX_PLAYERS, WINNING_SCORE, SITE_URL (for the printed
# link), NOMIC_PERSIST_TO (local state dir, used by the tests).
set -euo pipefail
cd "$(dirname "$0")/.."

where="--local"
[ "${1:-}" = "--remote" ] && where="--remote"
name="${GAME_NAME:-Nomic, game 1}"
max="${MAX_PLAYERS:-5}"
win="${WINNING_SCORE:-100}"
site="${SITE_URL:-http://localhost:8788}"
case "$max$win" in *[!0-9]*) echo "MAX_PLAYERS and WINNING_SCORE must be numbers" >&2; exit 1;; esac

# 8 characters, no 0/O/1/I/L lookalikes: about 40 bits.
# (|| true: head closing the pipe makes tr exit 141 under pipefail.)
code="$(LC_ALL=C tr -dc 'A-HJKMNP-Z2-9' </dev/urandom | head -c 8 || true)"
[ "${#code}" -eq 8 ] || { echo "could not generate a code" >&2; exit 1; }
id="$(uuidgen | tr 'A-Z' 'a-z')"
sqlname="${name//\'/\'\'}"
persist=()
[ -n "${NOMIC_PERSIST_TO:-}" ] && persist=(--persist-to "$NOMIC_PERSIST_TO")

npx wrangler d1 execute DB "$where" ${persist[@]+"${persist[@]}"} --command \
  "INSERT INTO games (id, name, join_code, status, max_players, winning_score, created_at)
   VALUES ('$id', '$sqlname', '$code', 'setup', $max, $win, strftime('%Y-%m-%dT%H:%M:%fZ','now'));" >/dev/null

echo "Game: $name"
echo "Join code: $code"
echo "Join link: $site/join/$code"
