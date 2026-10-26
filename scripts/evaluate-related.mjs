// Opt-in billed evaluation, synthetic fixtures and empty disposable accounts only.
// See docs/SOURCES-AND-RELATED.md. Never use a real user's collection.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createNotesRepository } from '../src/lib/notes-repository.ts';
import { createSourcesRepository } from '../src/lib/sources-repository.ts';
import { createContextRepository } from '../src/lib/context-repository.ts';
import { createRelatedRepository } from '../src/lib/related-repository.ts';
const file=process.env.TWINKLE_TEST_FIXTURES, reportFile=process.env.TWINKLE_EVAL_REPORT;
assert.ok(file && reportFile,'Set TWINKLE_TEST_FIXTURES and TWINKLE_EVAL_REPORT to private/output paths.');
const users=JSON.parse(await readFile(file,'utf8'));
const fixtures=JSON.parse(await readFile(new URL('../tests/fixtures/related-evaluation.json',import.meta.url),'utf8'));
const client=()=>createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const a=client(),b=client(),fresh=client(),notes=createNotesRepository(a),sources=createSourcesRepository(a),related=createRelatedRepository(a);
const rows=new Map(),ids=[]; let foreign; const failures=[];
const report={at:new Date().toISOString(),checks:'Synthetic semantic smoke tests plus manual review of each explanation, not a proof of general accuracy.',results:[]};
async function invoke(api,noteId,retry=false){
 const r=await api.functions.invoke('related-notes',{body:{noteId,retry},timeout:20000});
 if(r.error){const detail=await r.error.context?.json?.().catch(()=>null);throw new Error(detail?.error??r.error.message);}return r.data;
}
try{
 assert.ifError((await a.auth.signInWithPassword(users[0])).error);
 assert.ifError((await b.auth.signInWithPassword(users[1])).error);
 assert.ifError((await fresh.auth.signInWithPassword(users[0])).error);
 assert.equal((await notes.list(users[0].id)).length,0,'Use an empty disposable account');
 await createContextRepository(a).setPreference(users[0].id,false);
 for(const item of fixtures.notes){const n=await notes.save(users[0].id,item.text);rows.set(item.key,n);ids.push(n.id);}
 foreign=await createNotesRepository(b).save(users[1].id,'Creativity and consistency in another private collection.');
 const book=rows.get('photo-text'),source=await sources.get(users[0].id,book.id);
 const saved=await sources.save(users[0].id,source,{source_type:'book',name:'The Creative Practice',url:'https://example.com/creative-practice',description:'A synthetic attribution for evaluation.'});
 assert.equal((await createSourcesRepository(fresh).get(users[0].id,book.id)).name,saved.name);
 await assert.rejects(sources.save(users[0].id,source,{source_type:'book',name:'Stale overwrite',url:'',description:''}),/another session/);
 assert.equal((await b.from('note_sources').select('*').eq('note_id',book.id)).data.length,0);
 assert.equal((await invoke(a,book.id)).status,'disabled');
 await createContextRepository(a).setPreference(users[0].id,true);
 assert.ok((await b.functions.invoke('related-notes',{body:{noteId:book.id}})).error);
 assert.ok((await client().functions.invoke('related-notes',{body:{noteId:book.id}})).error);
 for(const fixture of fixtures.cases){
  const note=rows.get(fixture.key),start=performance.now();
  const accepted=await invoke(a,note.id);assert.equal(accepted.status,'processing');
  const repeated=await invoke(a,note.id);assert.ok(['processing','completed'].includes(repeated.status));
  let state;
  for(let i=0;i<70;i++){
   state=await related.status(users[0].id,note.id);
   if(state?.status==='failed')throw Error(`Analysis failed for ${fixture.key}`);
   if(state?.status==='completed')break;
   await new Promise(resolve=>setTimeout(resolve,1100));
  }
  assert.equal(state?.status,'completed');
  const links=await related.read(note.id);
  const keys=links.map(r=>[...rows].find(([,n])=>n.id===r.id)?.[0]);
  const result={key:fixture.key,elapsedMs:Math.round(performance.now()-start),keys,links:links.map(r=>({key:[...rows].find(([,n])=>n.id===r.id)?.[0],explanation:r.explanation})),review:fixture.review};
  report.results.push(result);await writeFile(reportFile,JSON.stringify(report,null,2));
  assert.ok(links.length<=3);
  assert.ok(!links.some(r=>r.id===note.id||r.id===foreign.id));
  if(fixture.expectedAny.length&&!fixture.expectedAny.some(key=>keys.includes(key)))failures.push(`${fixture.key}: missing meaningful relation (${keys})`);
  if(fixture.forbidden==='all'&&links.length)failures.push(`${fixture.key}: expected no forced connection`);
  else if(Array.isArray(fixture.forbidden))for(const key of fixture.forbidden)if(keys.includes(key))failures.push(`${fixture.key}: unrelated ${key}`);
  assert.deepEqual(await createRelatedRepository(fresh).read(note.id),links);
  assert.equal((await createRelatedRepository(b).read(note.id)).length,0);
  assert.equal((await invoke(a,note.id)).status,'completed','Cached result should not call AI again');
  console.log(`${fixture.key}: ${keys.join(', ') || 'no connection'} (${result.elapsedMs}ms)`);
 }
 const edited=await notes.save(users[0].id,'A wholly different idea about repairing a bicycle.',book);
 assert.equal((await sources.get(users[0].id,book.id)).name,saved.name);
 assert.equal((await related.read(book.id)).length,0,'Edited note must not retain stale links');
 assert.equal((await related.status(users[0].id,book.id)),null);
 assert.equal((await notes.get(users[0].id,edited.id)).content,edited.content);
 assert.deepEqual(failures,[], 'Review semantic retrieval failures');
 console.log('PASS: source persistence/CAS, cached analysis, cross-user denial, original content unchanged, edit invalidation.');
}finally{
 if(ids.length)assert.ifError((await a.from('notes').delete().in('id',ids)).error);
 if(foreign)assert.ifError((await b.from('notes').delete().eq('id',foreign.id)).error);
 await Promise.all([a,b,fresh].map(api=>api.auth.signOut({scope:'global'})));
}
