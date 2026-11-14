#!/usr/bin/env python3
"""Markdown tables per angle, joining data/angles.tsv with a stats snapshot.

    python3 tools/landscape_tables.py data/snapshots/2026-11-08.jsonl
"""
import csv
import json
import sys
from collections import defaultdict

snap = {}
for path in sys.argv[1:]:
    for line in open(path):
        if line.strip():
            s = json.loads(line)
            snap[s["repo"].lower()] = s

groups = defaultdict(list)
with open("data/angles.tsv") as f:
    for row in csv.DictReader(f, delimiter="\t"):
        groups[row["angle"]].append(row)


def fmt(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


for angle, rows in groups.items():
    print(f"\n#### {angle}\n")
    print("| Repo | ⭐ | Started | ⭐/day now ÷ lifetime | Hooks in | What it does |")
    print("|---|---|---|---|---|---|")
    rows.sort(key=lambda r: -(snap.get(r["repo"].lower()) or {}).get("stars", 0))
    for r in rows:
        s = snap.get(r["repo"].lower())
        if s:
            m = (s["stars_per_day_recent"] / s["stars_per_day_lifetime"]) if s["stars_per_day_lifetime"] else 0
            stars, start = fmt(s["stars"]), s["created"][:7]
            mom = f"{s['stars_per_day_recent']:g} ÷ {s['stars_per_day_lifetime']:g} ({m:.2f}×)"
            if s["archived"]:
                mom += " archived"
        else:
            stars = start = mom = "?"
        name = r["repo"].split("/")[1]
        print(f"| [{name}](https://github.com/{r['repo']}) | {stars} | {start} | {mom} | {r['hooks_in']} | {r['note']} |")
