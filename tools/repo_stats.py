#!/usr/bin/env python3
"""Popularity, age and growth for GitHub repos, from the GitHub API (via `gh`).

Usage:
    python3 tools/repo_stats.py owner/name [owner/name ...] > stats.jsonl
    python3 tools/repo_stats.py --table < stats.jsonl     # markdown table

Per repo it records: stars, forks, created/pushed dates, age in days, licence,
latest release, commit count, lifetime stars per day, and recent stars per day.

Growth: GitHub stopped serving stargazer timestamps (GraphQL returns none,
REST 404s; checked 2026-11-08), so the recent rate comes from WatchEvents in the
events feed (see recent_velocity). For a hot repo that feed covers only hours,
so read it as "right now", not "this month". For the full curve, open
https://star-history.com/#owner/name. Save each run under data/snapshots/ and
diff two snapshots for true growth over a period. Needs `gh auth login`.
"""
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone

META = """
query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
  nameWithOwner stargazerCount forkCount createdAt pushedAt isArchived
  description homepageUrl licenseInfo{spdxId}
  primaryLanguage{name}
  repositoryTopics(first:12){nodes{topic{name}}}
  latestRelease{tagName publishedAt}
  releases{totalCount}
  defaultBranchRef{target{... on Commit{history{totalCount}}}}
}}"""

def gql(query, **v):
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, val in v.items():
        if val is not None:
            args += ["-F", f"{k}={val}"]
    out = subprocess.run(args, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return json.loads(out.stdout)["data"]["repository"]


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def recent_velocity(full, now, age_days):
    """Stars per day lately, from WatchEvents in the public events feed.

    GitHub no longer lists stargazers with timestamps, but the events feed
    keeps up to 300 events from the last 90 days. A star is a WatchEvent.
    Window: back to the oldest event read if the feed was full, else
    90 days (or the repo's age if younger)."""
    events, last_page_full = [], False
    for page in (1, 2, 3):  # GitHub serves at most 3 pages of 100
        out = subprocess.run(["gh", "api", f"repos/{full}/events?per_page=100&page={page}"],
                             capture_output=True, text=True)
        if out.returncode != 0:
            break
        batch = json.loads(out.stdout)
        events += batch
        # a page can hold a few less than 100 mid-feed (hidden events),
        # so "nearly full" means the feed went on
        last_page_full = len(batch) >= 90
        if not last_page_full:
            break
    stars = [ts(e["created_at"]) for e in events if e["type"] == "WatchEvent"]
    if last_page_full and events:  # feed capped: it covers only back to the oldest event
        window = (now - ts(events[-1]["created_at"])).total_seconds() / 86400
    else:
        window = min(90, age_days)
    window = max(window, 1 / 24)
    return round(len(stars) / window, 1), round(window, 2), len(stars)


def stats(full):
    owner, name = full.split("/", 1)
    now = datetime.now(timezone.utc)
    r = gql(META, owner=owner, name=name)
    age = max((now - ts(r["createdAt"])).days, 1)
    vel, window, n = recent_velocity(r["nameWithOwner"], now, age)
    hist = (r.get("defaultBranchRef") or {}).get("target") or {}
    return {
        "repo": r["nameWithOwner"],
        "stars": r["stargazerCount"],
        "forks": r["forkCount"],
        "created": r["createdAt"][:10],
        "pushed": r["pushedAt"][:10],
        "age_days": age,
        "archived": r["isArchived"],
        "license": (r.get("licenseInfo") or {}).get("spdxId"),
        "language": (r.get("primaryLanguage") or {}).get("name"),
        "topics": [n["topic"]["name"] for n in r["repositoryTopics"]["nodes"]],
        "releases": r["releases"]["totalCount"],
        "latest_release": r["latestRelease"],
        "commits": (hist.get("history") or {}).get("totalCount"),
        "stars_per_day_recent": vel,
        "recent_window_days": window,
        "recent_stars_seen": n,
        "stars_per_day_lifetime": round(r["stargazerCount"] / age, 1),
        "description": r["description"],
        "homepage": r["homepageUrl"],
        "measured": now.strftime("%Y-%m-%d"),
    }


def momentum(s):
    """Recent stars/day vs the lifetime average: >1 accelerating, <1 cooling."""
    if not s["stars_per_day_lifetime"]:
        return None
    return round(s["stars_per_day_recent"] / s["stars_per_day_lifetime"], 2)


def span(days):
    return f"{days * 24:.0f} h" if days < 2 else f"{days:.0f} d"


def table(rows):
    print("| Repo | ⭐ | Age (d) | ⭐/day lifetime | ⭐/day now (window) | Momentum | Last push | Licence |")
    print("|---|---|---|---|---|---|---|---|")
    for s in sorted(rows, key=lambda s: -s["stars"]):
        m = momentum(s)
        print(f"| [{s['repo']}](https://github.com/{s['repo']}) | {s['stars']:,} | {s['age_days']} | "
              f"{s['stars_per_day_lifetime']:,} | {s['stars_per_day_recent']:,} ({span(s['recent_window_days'])}) | "
              f"{'–' if m is None else f'{m}×'} | {s['pushed']} | {s['license'] or '–'} |")


if __name__ == "__main__":
    if sys.argv[1:] == ["--table"]:
        table([json.loads(l) for l in sys.stdin if l.strip()])
        sys.exit()
    for full in sys.argv[1:]:
        try:
            print(json.dumps(stats(full), ensure_ascii=False), flush=True)
        except Exception as e:  # keep going; report on stderr
            print(f"{full}: {e}", file=sys.stderr)
