#!/usr/bin/env python3
"""Collect candidate papers from arXiv, then add citation counts from Semantic Scholar.

    python3 tools/paper_search.py search queries.txt > candidates.jsonl   # one arXiv query per line
    python3 tools/paper_search.py cite < candidates.jsonl > cited.jsonl

Query lines use arXiv syntax, e.g.  abs:"prompt compression" AND abs:agent
Lines starting with # are ignored; "topic | query" tags each hit with a topic.
arXiv asks for one request every 3 seconds; this script waits 3.1 s.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "token-saving-research/0.1 (paper survey script)"}


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **({"Content-Type": "application/json"} if data else {})})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode()
        except Exception as e:  # 429 / 503: back off
            time.sleep(5 * (attempt + 1))
            err = e
    raise err


def arxiv(query, n=40):
    q = urllib.parse.urlencode({"search_query": query, "max_results": n, "sortBy": "relevance"})
    x = get(f"https://export.arxiv.org/api/query?{q}")
    out = []
    for e in re.findall(r"<entry>(.*?)</entry>", x, re.S):
        g = lambda k: " ".join(re.search(rf"<{k}>(.*?)</{k}>", e, re.S).group(1).split())
        aid = re.sub(r"v\d+$", "", g("id").rsplit("/abs/", 1)[1])
        out.append({"arxiv": aid, "title": g("title"), "published": g("published")[:10],
                    "abstract": g("summary"),
                    "authors": [" ".join(a.split()) for a in re.findall(r"<name>(.*?)</name>", e, re.S)][:6]})
    return out


def search(path):
    seen = {}
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        topic, _, query = line.partition(" | ") if " | " in line else ("", "", line)
        for p in arxiv(query):
            if p["arxiv"] in seen:
                seen[p["arxiv"]]["topics"].add(topic)
            else:
                p["topics"] = {topic}
                seen[p["arxiv"]] = p
        print(f"{len(seen):4d} after {query}", file=sys.stderr)
        time.sleep(3.1)
    for p in seen.values():
        p["topics"] = sorted(t for t in p["topics"] if t)
        print(json.dumps(p, ensure_ascii=False))


def cite():
    rows = [json.loads(l) for l in sys.stdin if l.strip()]
    for i in range(0, len(rows), 400):
        chunk = rows[i:i + 400]
        body = json.dumps({"ids": [f"ARXIV:{r['arxiv']}" for r in chunk]}).encode()
        res = json.loads(get("https://api.semanticscholar.org/graph/v1/paper/batch"
                             "?fields=citationCount,venue,year", data=body))
        for r, s in zip(chunk, res):
            r["citations"] = (s or {}).get("citationCount")
            r["venue"] = (s or {}).get("venue") or None
        time.sleep(3)
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    {"search": lambda: search(sys.argv[2]), "cite": cite}[sys.argv[1]]()
