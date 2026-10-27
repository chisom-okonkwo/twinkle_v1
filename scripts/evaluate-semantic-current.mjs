// Uses the retained, strictly synthetic disposable Phase B fixture.
import assert from'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{createClient}from'@supabase/supabase-js';
const users=JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES,'utf8'));assert.ok(users.every(u=>/^twinkle-themes-[0-9a-f-]+@example\.invalid$/.test(u.email)));
const ids=JSON.parse(await readFile(process.env.TWINKLE_FIXTURE_IDS,'utf8'));const names=Object.fromEntries(Object.entries(ids).map(([k,v])=>[v,k]));
const f=JSON.parse(await readFile(new URL('../tests/fixtures/semantic-themes-evaluation.json',import.meta.url),'utf8'));
const api=createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await api.auth.signInWithPassword(users[0])).error);
const owned=await api.from('notes').select('id');assert.ifError(owned.error);assert.equal(owned.data.length,f.notes.length);assert.ok(owned.data.every(n=>names[n.id]));
const started=performance.now();const result=await api.functions.invoke('semantic-notes',{body:{retry:true},timeout:20000});assert.ifError(result.error);
let state;for(let i=0;i<120;i++){const r=await api.rpc('semantic_index_snapshot');assert.ifError(r.error);state=r.data;if(state.status==='failed')throw new Error('Semantic run failed: '+state.error_code);if(state.status!=='processing')break;await new Promise(resolve=>setTimeout(resolve,1000));}
assert.notEqual(state.status,'processing');
const snapshot=await api.rpc('note_theme_snapshot',{period:'all'});assert.ifError(snapshot.error);const groups=[];
for(const group of snapshot.data.themes){const r=await api.rpc('read_note_theme_members',{target_id:group.id,period:'all',page_offset:0});assert.ifError(r.error);const keys=r.data.map(n=>names[n.note_id]);assert.equal(new Set(keys).size,group.note_count);groups.push({label:group.label,count:group.note_count,keys});}
const rubric=f.expectedGroups.map(g=>({concept:g.concept,found:groups.some(t=>t.keys.filter(k=>g.members.includes(k)).length>=g.minimumRecall&&!t.keys.some(k=>g.forbidden.includes(k)))}));
const unwanted=groups.flatMap(g=>g.keys.filter(k=>f.mustRemainUngrouped.includes(k)));
const report={phase:'D',elapsedMs:Math.round(performance.now()-started),progress:state,groups,rubric,unwanted};
await writeFile(process.env.TWINKLE_EVAL_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify({phase:'D',ms:report.elapsedMs,groups:groups.length,found:rubric.filter(x=>x.found).length,expected:rubric.length,unwanted:unwanted.length}));
await api.auth.signOut({scope:'global'});
assert.ok(rubric.every(r=>r.found),'An expected theme family was missed or had unsupported members');
assert.equal(unwanted.length,0,'Unwanted notes were grouped');
for(const group of groups)assert.ok(f.expectedGroups.some(g=>group.keys.every(k=>g.members.includes(k))),'A group mixed unrelated fixture subjects');
