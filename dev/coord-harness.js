// The coordinator's integration checks: the real register.tsx, one module copy per window,
// a real lock directory (mkdir/mv/rm), and a store that can fail on purpose.
// Run: node dev/coord-harness.js   (needs typescript installed globally, or TS=<path>)
const fs=require('fs'),path=require('path'),cp=require('child_process'),ts=require(process.env.TS || require('child_process').execSync('npm root -g').toString().trim()+'/typescript');
const ROOT=path.join(__dirname,'..','hooks'), LOCK=path.join(require('os').tmpdir(),'fleet-coord-harness.lock');
const api={atom:(x,value)=>({...x,value}),read:async($,a)=>(a.key in $.state? $.state[a.key]: a.value),update:async($,a,f)=>{$.state[a.key]=f(a.key in $.state? $.state[a.key]: a.value)}};
let cache={};function load(file){file=path.resolve(file);if(cache[file])return cache[file].exports;const m={exports:{}};cache[file]=m;let src=fs.readFileSync(file,'utf8');
 if(file.endsWith('register.tsx'))src+='\nexport const T={persist,claimAndSend,stopThread,withStoreLock,owner,setLock:(d)=>{lockDir=d},setSelf:(s)=>{self=s}};';
 const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText;
 new Function('require','module','exports','h',js)(p=>p==='claude-code'?api:load(path.resolve(path.dirname(file),p)+(fs.existsSync(path.resolve(path.dirname(file),p)+'.ts')?'.ts':'.tsx')),m,m.exports,()=>null);return m.exports;}
const fresh=(sid)=>{cache={};const T=load(ROOT+'/register.tsx').T;T.setLock(LOCK);T.setSelf(sid);return T};
const disk={};let failGet=false,failSet=false;
const store={get:async k=>{if(failGet)throw new Error('read failed');return disk[k]===undefined?undefined:JSON.parse(JSON.stringify(disk[k]))},set:async(k,v)=>{if(failSet)throw new Error('write failed');disk[k]=JSON.parse(JSON.stringify(v))}};
const proc={run:async(argv)=>{const r=cp.spawnSync(argv[0],argv.slice(1));return{exitCode:r.status,stdout:String(r.stdout),stderr:String(r.stderr)}},spawn:()=>({[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{}),return:async()=>({done:true})})})};
const fsApi={stat:async p=>{const s=fs.statSync(p);return{mtimeMs:s.mtimeMs,kind:'dir'}},read:async p=>fs.readFileSync(p,'utf8'),write:async(p,t)=>fs.writeFileSync(p,t),exists:async p=>fs.existsSync(p)};
const clock={sleep:ms=>new Promise(r=>setTimeout(r,ms))};
const now=()=>Date.now()/1000;
const thread=(name,extra={})=>({name,agent:'codex',model:'default',effort:'default',mode:'read',cwd:'/p',by:'you',session:'',status:'idle',turns:[],compactions:0,brief:'',created:0,updated:now(),...extra});
const win=(threads)=>({state:{threads},store,process:proc,fs:fsApi,clock,env:{get:async()=>'/h'},ui:{toast(){},ask:async()=>''},prompt:{submit:async()=>{}}});
const ask={name:'t',task:'x',context:'',by:'you',agent:'codex'};
const ok=(name,cond)=>console.log((cond?'PASS ':'FAIL ')+name);
const reset=()=>{fs.rmSync(LOCK,{recursive:true,force:true});for(const k of Object.keys(disk))delete disk[k];failGet=failSet=false};
(async()=>{
  // F1: someone holds the lock past the 3 s wait: the claim is refused, never made unlocked
  reset(); fs.mkdirSync(LOCK); fs.writeFileSync(LOCK+'/token','other-window');
  let A=fresh('A'); let r=await A.claimAndSend(win([thread('t')]),'t',ask);
  ok('F1 busy lock refuses the claim', typeof r==='string' && /saving right now/.test(r) && !(disk.threads||[]).some(t=>t.status==='running'));
  // F2: a stale lock (dead window) is broken safely; release keeps a successor's lock
  reset(); fs.mkdirSync(LOCK); fs.writeFileSync(LOCK+'/token','dead'); const old=new Date(Date.now()-60_000); fs.utimesSync(LOCK,old,old);
  A=fresh('A'); await A.withStoreLock(win([]),async()=>{}); ok('F2 stale lock broken and released', !fs.existsSync(LOCK) && fs.readdirSync(require('os').tmpdir()).every(f=>!f.startsWith('fleet-coord-harness.lock.dead')));
  reset(); A=fresh('A'); await A.withStoreLock(win([]),async()=>{ fs.writeFileSync(LOCK+'/token','successor') });
  ok('F2 an overrunning holder never deletes its successor\'s lock', fs.existsSync(LOCK) && fs.readFileSync(LOCK+'/token','utf8')==='successor');
  // F4: A finished its run; B, still holding a stale running copy, presses stop: A's answer must survive
  reset(); const t0=now();
  disk.threads=[thread('t',{status:'idle',updated:t0+5,turns:[{n:1,by:'you',ask:'x',status:'done',started:t0,ended:t0+5,answer:'SUMMARY: A finished',log:[],contextTokens:0,outputTokens:0,isHanded:false}]})];
  const B=fresh('B'); const stale=thread('t',{status:'running',updated:t0,lease:{sid:'A',since:t0,at:now()},turns:[{n:1,by:'you',ask:'x',status:'running',started:t0,answer:'',log:[],contextTokens:0,outputTokens:0,isHanded:false}]});
  const wb=win([stale]); const how=await B.stopThread(wb,'t');
  ok('F4 remote stop leaves the finished answer in the store', how==='asked' && disk.threads[0].status==='idle' && disk.threads[0].turns[0].answer==='SUMMARY: A finished');
  // F5: a failed store read refuses the claim instead of treating the store as empty
  reset(); disk.threads=[thread('t',{status:'running',lease:{sid:'C',since:now(),at:now()}})]; failGet=true;
  A=fresh('A'); r=await A.claimAndSend(win([thread('t')]),'t',ask);
  ok('F5 failed read refuses the claim', typeof r==='string' && /Couldn't read/.test(r)); failGet=false;
  ok('F5 the other window\'s run is untouched', disk.threads[0].lease.sid==='C');
  // F7: a failed claim write is rolled back: no phantom owner, thread not left running
  reset(); A=fresh('A'); failSet=true; const w=win([thread('t')]); r=await A.claimAndSend(w,'t',ask); failSet=false;
  ok('F7 failed claim write rolled back', typeof r==='string' && /Couldn't save/.test(r) && !A.owner.has('t') && w.state.threads.find(t=>t.name==='t').status==='idle');
  // the original races still hold
  reset(); disk.threads=[thread('shared')]; const X=fresh('X'),Y=fresh('Y');
  const rs=await Promise.all([X.claimAndSend(win([thread('shared')]),'shared',{...ask,name:'shared'}),Y.claimAndSend(win([thread('shared')]),'shared',{...ask,name:'shared'})]);
  ok('race: exactly one window starts a thread', rs.filter(x=>typeof x!=='string').length===1);
  reset(); disk.threads=[]; const P=fresh('P'),Q=fresh('Q');
  await Promise.all([P.persist(win([thread('from-P')])),Q.persist(win([thread('from-Q')]))]);
  ok('race: two simultaneous saves keep both', ['from-P','from-Q'].every(n=>disk.threads.some(t=>t.name===n)));
  reset(); process.exit(0)
})().catch(e=>{console.error(e);process.exit(1)});
