# Run: python3 -I research/measure-nightly-read.py   (reads ~/.claude/projects on this Mac; sends nothing)
# Measures what a nightly taste read would cost: full transcripts vs only the candidate moments.
import json, glob, os, re, collections, datetime
CORR = re.compile(r"^\s*(no\b|nope|don'?t|do not|stop\b|wrong|not that|i said|i meant|instead\b|actually\b|revert|undo|why did you|that'?s not|please don'?t|never\b)", re.I)
REJ = re.compile(r"user (rejected|doesn't want to proceed|denied)|tool use was rejected", re.I)
days = collections.defaultdict(lambda: dict(sessions=set(), chat_chars=0, all_chars=0, cands=0, snippet_chars=0, rejects=0))
def text_of(content):
    if isinstance(content, str): return content
    out=[]
    for b in content or []:
        if isinstance(b, dict) and b.get('type')=='text': out.append(b.get('text',''))
    return '\n'.join(out)
for f in glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl')):
    last_assistant = ''
    for line in open(f, errors='ignore'):
        try: e=json.loads(line)
        except: continue
        ts=e.get('timestamp','')[:10]
        if not ts: continue
        d=days[ts]; d['sessions'].add(f); d['all_chars']+=len(line)
        m=e.get('message') or {}
        c=m.get('content')
        if e.get('type')=='assistant':
            t=text_of(c); d['chat_chars']+=len(t)
            if t: last_assistant=t
        elif e.get('type')=='user':
            if isinstance(c, list) and any(isinstance(b,dict) and b.get('type')=='tool_result' for b in c):
                for b in c:
                    if isinstance(b,dict) and b.get('type')=='tool_result' and REJ.search(json.dumps(b.get('content',''))[:2000]):
                        d['rejects']+=1; d['cands']+=1; d['snippet_chars']+=min(len(last_assistant),600)+200
                continue
            t=text_of(c)
            if not t or t.startswith('<'): continue
            d['chat_chars']+=len(t)
            if CORR.search(t):
                d['cands']+=1; d['snippet_chars']+=min(len(t),600)+min(len(last_assistant),600)
today=datetime.date.today()
rows=[(k,v) for k,v in sorted(days.items()) if (today-datetime.date.fromisoformat(k)).days<=10]
print(f"{'day':10} {'sessions':>8} {'raw log':>9} {'chat text':>10} {'moments':>8} {'snippets':>9}")
tot=collections.Counter()
for k,v in rows:
    tk=lambda ch: ch//4
    print(f"{k:10} {len(v['sessions']):>8} {tk(v['all_chars'])//1000:>8}k {tk(v['chat_chars'])//1000:>9}k {v['cands']:>8} {tk(v['snippet_chars'])//1000:>8}k")
    tot['n']+=1; tot['raw']+=tk(v['all_chars']); tot['chat']+=tk(v['chat_chars']); tot['c']+=v['cands']; tot['s']+=tk(v['snippet_chars']); tot['rej']+=v['rejects']
n=max(tot['n'],1)
print(f"\nper day on average: raw log {tot['raw']//n//1000}k tokens · chat text only {tot['chat']//n//1000}k · {tot['c']//n} moments ({tot['rej']} rejected tool uses in total) · snippets {tot['s']//n//1000}k tokens")
