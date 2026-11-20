# Per model: rules found, quotes that match the log word for word, tokens and time. Writes rules-<model>.txt for reading.
import json,glob,re,sys,os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
def norm(s): return re.sub(r'\s+',' ',s).strip().lower()
for m in ['haiku','sonnet','opus']:
    rules=[];q=qok=0;tin=tout=0;ms=0;bad=0
    lines=[]
    for d in [14,15,16,17,18,19]:
        try: r=json.load(open(f'out/{m}-{d}.json'))
        except Exception as e: bad+=1; continue
        u=r.get('usage',{}); tin+=u.get('input_tokens',0)+u.get('cache_read_input_tokens',0)+u.get('cache_creation_input_tokens',0); tout+=u.get('output_tokens',0); ms+=r.get('duration_ms',0)
        log=norm(''.join(l.split(' YOU: ',1)[1] if ' YOU: ' in l else '' for l in open(f'stripped-2026-11-{d}.txt')))
        blocks=[];inyou=False
        for l in open(f'stripped-2026-11-{d}.txt'):
            if re.match(r'^\d\d:\d\d (YOU|CLAUDE): ',l) or l.startswith('      ') or l.startswith('====='):
                inyou=' YOU: ' in l[:12]
                if inyou: blocks.append(l.split('YOU: ',1)[1])
            elif inyou: blocks[-1]+=l
        logyou=' ¶ '.join(norm(b) for b in blocks)  # only the person's own words count as receipts
        txt=r.get('result','');j=txt[txt.find('['):txt.rfind(']')+1]
        try: arr=json.loads(j)
        except: bad+=1; continue
        for x in arr:
            qs=x.get('quotes',[]); ok=[norm(s) in logyou for s in qs]; q+=len(qs); qok+=sum(ok)
            lines.append(f"[11-{d}] ({x.get('strength')}) {x.get('rule')}\n      quotes: "+' | '.join(('✓ ' if o else '✗ ')+s[:90] for s,o in zip(qs,ok)))
            rules.append(x)
    open(f'rules-{m}.txt','w').write('\n'.join(lines))
    print(f"{m:7} rules={len(rules):3} quotes exact={qok}/{q} in={tin//1000}k out={tout//1000}k time={ms//1000}s unreadable={bad}")
