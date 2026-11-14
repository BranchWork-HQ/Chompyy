#!/usr/bin/env bash
# Find candidate repos for a theme by casting a wide net on GitHub search.
#
#   tools/discover.sh [min_stars] > candidates.tsv
#
# Prints stars, created, last push, repo, description (TSV), deduplicated,
# most stars first. Edit the three lists below for a new theme.
#
# Why three lists: keyword search only matches name/description/README, so it
# misses repos that describe themselves differently ("ghost tokens", "lean
# context"). Topic search catches repos that tagged themselves. Named lookups
# catch projects people mention that neither search surfaces (e.g. "rtk").
# After a run, read the top results' READMEs for names of competitors they
# compare against, add those to NAMES, and run again. Stop when a round adds
# nothing new.
#
# GitHub search allows 30 requests a minute; this script paces itself.
set -euo pipefail
MIN=${1:-150}

KEYWORDS=(
  "token saving" "token efficient" "reduce tokens claude code" "claude code token"
  "token usage claude code" "claude code cost" "prompt compression"
  "context compression llm" "compress tool output llm" "llm cost reduction"
  "token optimization agent" "context window optimization agent" "llm token budget"
  "llm router cost" "model routing llm" "semantic cache llm" "mcp token"
  "context pruning" "prompt caching claude" "subagent context"
)
TOPICS=(
  token-optimization prompt-compression context-compression token-saving
  token-efficiency context-engineering llm-cost cost-optimization llm-router
  context-window token-usage
)
NAMES=(
  caveman headroom rtk tokscale ccusage llmlingua routellm context-mode serena
  repomix claude-code-router magpie cc-switch token-optimizer codeburn
  TokenEconomizer pxpipe compresr ponytail
)
# ponytail (186k stars, the largest in the theme) never surfaced from keywords
# or topics on 2026-11-08: it describes itself as "write less code". It was
# found through a comparison article. Search the web for "<theme> tested" /
# "<tool> vs" posts, too.

search() {
  for _ in 1 2 3; do
    if out=$(gh search repos "$@" --sort stars --limit 40 \
      --json fullName,stargazersCount,createdAt,pushedAt,description 2>&1); then
      echo "$out"; return
    fi
    grep -qi "rate limit" <<<"$out" || { echo "[]"; return; }
    sleep 40
  done
  echo "[]"
}

{
  for q in "${KEYWORDS[@]}" "${NAMES[@]}"; do search "$q"; sleep 2.2; done
  for t in "${TOPICS[@]}"; do search --topic "$t"; sleep 2.2; done
} | jq -s -r --argjson min "$MIN" '
  add | unique_by(.fullName) | sort_by(-.stargazersCount) | .[]
  | select(.stargazersCount >= $min)
  | [.stargazersCount, .createdAt[:10], .pushedAt[:10], .fullName, ((.description // "") | gsub("[\t\n]"; " "))]
  | @tsv'
