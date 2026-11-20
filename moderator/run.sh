#!/bin/bash
# launchd wrapper for the moderator's night (com.chalant.promptocracy-moderator, every 2 minutes). Reads ONLY the keys
# the runner needs from ~/chalantbot/.env (never prints them) and runs one pass per game in games.manifest.json.
# The model never sees these: process-day.mjs gives `claude -p` a scrubbed environment (PATH, HOME, USER, LANG,
# TMPDIR, and the subscription OAuth token claude itself needs).
set -u
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
ENV_FILE="$HOME/chalantbot/.env"
HERE="$(cd "$(dirname "$0")" && pwd)"
get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
[ -f "$ENV_FILE" ] || { echo "moderator: no $ENV_FILE" >&2; exit 2; }
# The subscription credential only (sk-ant-oat01-...), never an API key: plan usage, not API dollars.
oat="$(get CLAUDE_API_KEY)"
case "$oat" in sk-ant-oat01-*) export CLAUDE_CODE_OAUTH_TOKEN="$oat" ;; *) echo "moderator: CLAUDE_API_KEY is not an oat01 subscription token; refusing to run" >&2; exit 2 ;; esac
unset ANTHROPIC_API_KEY
for k in CLOUDFLARE_WORKERS_TOKEN CLOUDFLARE_ACCOUNT_ID PROMPTOCRACY_BUILD_TRIGGER PROMPTOCRACY_API; do v="$(get "$k")"; [ -n "$v" ] && export "$k=$v"; done
status=0
for slug in $(/usr/bin/python3 -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1]))["games"]))' "$HERE/../games.manifest.json"); do
  key="PROMPTOCRACY_MODERATOR_TOKEN_$(echo "$slug" | tr '[:lower:]-' '[:upper:]_')"
  v="$(get "$key")"
  [ -n "$v" ] || continue # a game with no token is not moderated from this machine
  export "$key=$v"
  /opt/homebrew/bin/node "$HERE/process-day.mjs" --slug "$slug" || status=1
done
exit $status
