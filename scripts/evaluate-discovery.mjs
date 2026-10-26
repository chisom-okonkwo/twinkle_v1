// Explicit live evaluation with synthetic fixtures; no push delivery or notification scheduling.
// Prepare two empty/disposable confirmed accounts plus aged notes, as documented in docs/DISCOVERY.md.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createNotesRepository} from '../src/lib/notes-repository.ts';
import {createContextRepository} from '../src/lib/context-repository.ts';
import {createDiscoveryRepository} from '../src/lib/discovery-repository.ts';
import {createRelatedRepository} from '../src/lib/related-repository.ts';
const file=process.env.TWINKLE_TEST_FIXTURES,reportFile=process.env.TWINKLE_EVAL_REPORT;
assert.ok(file&&reportFile,'Private disposable-account fixture and synthetic report paths required.');
const users=JSON.parse(await readFile(file,'utf8'));
assert.ok(users.every(u=>u.email.startsWith('twinkle-discovery-')&&u.email.endsWith('@example.invalid')),'Use synthetic evaluation accounts only.');
const client=()=>createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const a=client(),b=client(),fresh=client(),notes=createNotesRepository(a),contexts=createContextRepository(a),related=createRelatedRepository(a),discovery=createDiscoveryRepository(a);
const report={at:new Date().toISOString(),results:[]},created=[];
async function record(check,detail){report.results.push({check,...detail});await writeFile(reportFile,JSON.stringify(report,null,2));console.log('PASS: '+check);}
async function invoke(name,body,api=a){const r=await api.functions.invoke(name,{body,timeout:20000});if(r.error){const detail=await r.error.context?.json?.().catch(()=>null);throw new Error(detail?.error??r.error.message);}return r.data;}
try{
 assert.ifError((await a.auth.signInWithPassword(users[0])).error);assert.ifError((await b.auth.signInWithPassword(users[1])).error);assert.ifError((await fresh.auth.signInWithPassword(users[0])).error);
 const originals=await notes.list(users[0].id);assert.ok(originals.length>=6,'Aged synthetic fixture notes required');
 const session=randomUUID(),topicRequest={mode:'topic',topic:'AtelierBlue',sessionId:session,requestId:randomUUID()};
 const topic=await discovery.next(topicRequest);assert.ok(topic);assert.match((await notes.get(users[0].id,topic.note_id)).content,/writing routine/);
 assert.deepEqual(await createDiscoveryRepository(fresh).next(topicRequest),topic,'Lost response/session replay must reuse note');
 assert.ok((await client().functions.invoke('discover-notes',{body:topicRequest})).error);
 const wrongOwner=await b.functions.invoke('discover-notes',{body:{...topicRequest,userId:users[0].id}});assert.ok(wrongOwner.error);
 await record('topic search reuses source attribution, persists history and replays safely',{title:topic.title});
 await contexts.setPreference(users[0].id,true);
 const saveStarted=performance.now(),note=await notes.save(users[0].id,"I've been thinking about how discipline might be the foundation of creative work, rather than waiting for inspiration.");created.push(note.id);
 const saveMs=Math.round(performance.now()-saveStarted);assert.equal((await notes.get(users[0].id,note.id)).content,note.content);
 assert.equal((await related.read(note.id,undefined,true)).length,0);
 await invoke('enrich-note',{noteId:note.id});
 let accepted=await invoke('related-notes',{noteId:note.id});assert.ok(['waiting_context','processing'].includes(accepted.status));
 const processStart=performance.now();let links=[];
 for(let i=0;i<90;i++){
  const row=await contexts.get(users[0].id,note.id);if(row.status==='failed')throw new Error('Synthetic context analysis failed');
  const status=await related.status(users[0].id,note.id);
  if(status?.status==='failed')throw new Error('Synthetic related analysis failed');
  if(status?.status==='completed'){links=await related.read(note.id,undefined,true);break;}
  if(row.status==='completed'&&!status)accepted=await invoke('related-notes',{noteId:note.id});
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.ok(links.length>=1&&links.length<=2);
 const oldIds=new Set(originals.map(n=>n.id));assert.ok(links.every(n=>oldIds.has(n.id)));
 for(const link of links){const n=await notes.get(users[0].id,link.id);assert.doesNotMatch(n.content,/therapist|medication|prefer not to rediscover/i);}
 assert.equal((await createRelatedRepository(b).read(note.id,undefined,true)).length,0);
 await invoke('discover-notes',{action:'capture_seen',originId:note.id,noteIds:links.map(n=>n.id)});
 assert.equal((await related.read(note.id,undefined,true)).length,links.length,'The current capture card should survive its own history recording');
 for(const link of links)await related.dismiss(note.id,link.id);
 assert.equal((await createRelatedRepository(fresh).read(note.id,undefined,true)).length,0);
 assert.equal((await invoke('related-notes',{noteId:note.id})).status,'completed','Reuse the same paid result');
 await record('post-save processing, grounded older connections, seen recording, persistent dismissal and owner isolation',{saveMs,totalProcessingMs:Math.round(performance.now()-processStart),explanations:links.map(n=>n.explanation)});
 const seen=new Set([topic.note_id]);
 let count=0;
 for(let i=0;i<8;i++){
  const request={mode:'surprise',topic:'',sessionId:session,requestId:randomUUID()},item=await discovery.next(request);if(!item)break;
  assert.ok(!seen.has(item.note_id),'Discovery repeated an already shown/captured note');seen.add(item.note_id);count++;
  const n=await notes.get(users[0].id,item.note_id);assert.doesNotMatch(n.content,/therapist|medication|prefer not to rediscover|Grocery list/);
  assert.ok(Date.parse(n.created_at)<=Date.now());
  await discovery.dismiss(users[0].id,item.request_id);
  assert.equal((await b.from('note_discovery_history').select('*').eq('request_id',item.request_id)).data.length,0);
 }
 assert.ok(count>0,'At least one safe older thought should remain');
 await record('surprise selection, no repeats, negative feedback and graceful exhaustion',{discoveries:count});
 const edited=await notes.save(users[0].id,'A different note about a bicycle repair.',note);
 assert.equal((await related.read(note.id,undefined,true)).length,0);assert.equal((await notes.get(users[0].id,edited.id)).content,edited.content);
 for(const old of originals)assert.equal((await notes.get(users[0].id,old.id)).content,old.content);
 const empty=await discovery.next({mode:'topic',topic:'unmatchablequartzxyz',sessionId:session,requestId:randomUUID()});assert.equal(empty,null);
 await record('edit invalidation, original content preserved and no-match state',{});
}finally{
 if(created.length)assert.ifError((await a.from('notes').delete().in('id',created)).error);
 await Promise.all([a,b,fresh].map(api=>api.auth.signOut({scope:'global'})));
}
