#!/bin/bash
# run.sh <model> : read each day with this model; results in out/<model>-<day>.json
cd "$(dirname "$0")"; mkdir -p out
for d in 14 15 16 17 18 19; do
  cat prompt.md stripped-2026-11-$d.txt | (cd /private/tmp && claude -p --model "$1" --output-format json --tools "" --strict-mcp-config --no-session-persistence --setting-sources "") > out/$1-$d.json 2> out/$1-$d.err
done
