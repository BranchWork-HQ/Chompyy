# Strip one day of Claude Code sessions to what a nightly taste read would see. Reads ~/.claude/projects; sends nothing.
import json,glob,os,sys,re,subprocess
day=sys.argv[1]; out=open(sys.argv[2],'w')
REJ=re.compile(r"user (rejected|doesn't want to proceed|denied)|tool use was rejected",re.I)
def txt(c):
    if isinstance(c,str): return c
    return '\n'.join(b.get('text','') for b in c or [] if isinstance(b,dict) and b.get('type')=='text')
def stub(b):
    i=b.get('input') or {}; n=b.get('name','?')
    arg=i.get('file_path') or i.get('command') or i.get('pattern') or i.get('url') or i.get('description') or ''
    return f"[{n}: {str(arg).splitlines()[0][:70] if arg else ''}]"
tot_raw=tot_out=0
for f in sorted(glob.glob(os.path.expanduser('~/.claude/projects/*/*.jsonl'))):
    lines=[];raw=0;skip=False;started=None
    for l in open(f,errors='ignore'):
        if skip: break
        try:e=json.loads(l)
        except:continue
        if e.get('entrypoint')=='claude-desktop': skip=True; lines=[]; break  # coding folders only: no desktop-app chats
        if e.get('cwd') and not started:
            started=e['cwd']  # decided once, from where the session started: a coding folder is a git repo
            if subprocess.run(['git','-C',started,'rev-parse','--git-dir'],capture_output=True).returncode!=0: skip=True; lines=[]; break
        if not e.get('timestamp','').startswith(day): continue
        raw+=len(l); m=e.get('message') or {}; c=m.get('content'); t=e['timestamp'][11:16]
        if e.get('type')=='assistant':
            s=txt(c).strip()
            if s: lines.append(f"{t} CLAUDE: {s}")
            for b in c if isinstance(c,list) else []:
                if isinstance(b,dict) and b.get('type')=='tool_use': lines.append(f"      {stub(b)}")
        elif e.get('type')=='user' and not e.get('isMeta'):
            if isinstance(c,list) and any(isinstance(b,dict) and b.get('type')=='tool_result' for b in c):
                for b in c:
                    if isinstance(b,dict) and b.get('type')=='tool_result' and REJ.search(json.dumps(b.get('content',''))[:2000]):
                        lines.append("      ⚑ YOU TURNED DOWN THIS TOOL USE")
                continue
            s=txt(c).strip()
            if not s: continue
            if s.startswith('[Request interrupted'): lines.append("      ⚑ YOU INTERRUPTED"); continue
            if s.startswith('<'): continue
            lines.append(f"{t} YOU: {s}")
    if not lines: continue
    body='\n'.join(lines); tot_raw+=raw; tot_out+=len(body)
    proj=f.split('/projects/')[1].split('/')[0].replace('-Users-davidchung-','~/').replace('-','/')
    out.write(f"\n===== session in {proj} · raw {raw//4000}k tokens → stripped {len(body)//4000}k =====\n{body}\n")
print(f"{day}: raw {tot_raw//4000}k tokens → stripped {tot_out//4000}k tokens")
