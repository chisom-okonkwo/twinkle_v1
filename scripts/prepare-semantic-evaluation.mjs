// Phase B live gate. Creates synthetic notes in an empty disposable account and
// intentionally retains them for subsequent neighbour/group gates.
import assert from 'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{createClient}from'@supabase/supabase-js';import{createContextRepository}from'../src/lib/context-repository.ts';
const users=JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES,'utf8'));assert.ok(users.length===2&&users.every(u=>/^twinkle-themes-[0-9a-f-]+@example\.invalid$/.test(u.email)));
const f=JSON.parse(await readFile(new URL('../tests/fixtures/semantic-themes-evaluation.json',import.meta.url),'utf8'));
const api=createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
assert.ifError((await api.auth.signInWithPassword(users[0])).error);assert.equal((await api.from('notes').select('id')).data.length,0);
await createContextRepository(api).setPreference(users[0].id,false);const ids={};
for(const n of f.notes){const r=await api.rpc('import_text_note',{file_name:`${n.key}.json`,body:n.body,metadata:{title:n.title,provider:'google_keep',...(n.date?{created_at:n.date}:{})}});assert.ifError(r.error);ids[n.key]=r.data.id;}
assert.ifError((await api.from('context_preferences').update({enabled:true}).eq('user_id',users[0].id)).error);
const read=async()=>{const r=await api.rpc('semantic_index_snapshot');assert.ifError(r.error);return r.data;};
assert.equal((await read()).indexed,0,'Importing alone must not index historical notes');
async function run(body){const start=performance.now();const r=await api.functions.invoke('semantic-notes',{body,timeout:20000});assert.ifError(r.error);let s;for(let i=0;i<80;i++){s=await read();assert.equal(s.failed,0,'Embedding request failed');if(s.status!=='processing')return{ms:Math.round(performance.now()-start),state:s};await new Promise(resolve=>setTimeout(resolve,1000));}throw new Error('Index timed out');}
const initial=await run({activate:true});assert.equal(initial.state.indexed,23);assert.equal(initial.state.excluded,1);assert.equal(initial.state.unsupported,0);
const unchanged=await run({});assert.equal(unchanged.state.indexed,23);
assert.ifError((await api.from('notes').update({title:'Dream journal — revisiting the same corridor'}).eq('id',ids['dream-short'])).error);
const edited=await run({});assert.equal(edited.state.indexed,23);
assert.ifError((await api.from('notes').update({title:f.notes.find(n=>n.key==='dream-short').title}).eq('id',ids['dream-short'])).error);
const restored=await run({});assert.equal(restored.state.indexed,23);
assert.ok((await api.from('note_embeddings').select('*')).error,'Private vectors must not be exposed as public notes');
await writeFile(process.env.TWINKLE_EVAL_REPORT,JSON.stringify({phase:'B',initial,unchanged,edited,restored},null,2));
await writeFile(process.env.TWINKLE_FIXTURE_IDS,JSON.stringify(ids),{mode:0o600});
console.log(JSON.stringify({phase:'B',initialMs:initial.ms,indexed:initial.state.indexed,excluded:initial.state.excluded,unchangedMs:unchanged.ms,editedMs:edited.ms,restoredMs:restored.ms}));
await api.auth.signOut({scope:'global'});
