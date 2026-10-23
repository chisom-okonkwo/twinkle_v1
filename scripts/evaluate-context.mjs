// Opt-in, billed evaluation. Use only empty disposable accounts and synthetic media.
// Reports contain synthetic source/output text but never account credentials or tokens.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {createNotesRepository} from '../src/lib/notes-repository.ts';
import {createContextRepository} from '../src/lib/context-repository.ts';
import {validateContextAnalysis} from '../supabase/functions/_shared/context-contract.ts';

if(!process.env.TWINKLE_TEST_FIXTURES || !process.env.TWINKLE_EVAL_REPORT) {
  throw new Error('Set TWINKLE_TEST_FIXTURES and TWINKLE_EVAL_REPORT. See docs/CONTEXT-EVALUATION.md.');
}
const mediaDirectory=process.env.TWINKLE_MEDIA_FIXTURES??fileURLToPath(new URL('../tests/fixtures/context-media/',import.meta.url));
const allCases=JSON.parse(await readFile(new URL('../tests/fixtures/context-evaluation.json',import.meta.url),'utf8'));
const chosen=process.env.TWINKLE_EVAL_CASES?.split(',');
if(chosen?.some(id=>!allCases.some(fixture=>fixture.id===id)))throw new Error('Unknown TWINKLE_EVAL_CASES identifier');
const cases=chosen?allCases.filter(fixture=>chosen.includes(fixture.id)):allCases;
const users=JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES,'utf8'));
const user=users[Number(process.env.TWINKLE_EVAL_USER??0)];
const client=()=>createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const api=client(),other=client();
const report={at:new Date().toISOString(),checks:'Lexical checks are smoke tests, not semantic grades; review outputs using each case rubric.',results:[]};
const noteIds=[],captureIds=[];
const notes=createNotesRepository(api),contexts=createContextRepository(api);
let failed=false;
async function invoke(name,body,timeout=20000) {
  const result=await api.functions.invoke(name,{body,timeout});
  if(result.error){ const detail=await result.error.context?.json?.().catch(()=>null);throw new Error(detail?.error??result.error.message); }
  return result.data;
}
async function complete(note) {
  const start=performance.now();
  const accepted=await invoke('enrich-note',{noteId:note.id});
  const acceptedMs=Math.round(performance.now()-start);
  for(let i=0;i<70;i++) {
    const row=await contexts.get(user.id,note.id);
    if(row.status==='completed')return {row,accepted,acceptedMs,totalMs:Math.round(performance.now()-start)};
    if(row.status==='failed')throw new Error(`Enrichment failed: ${row.error_code}`);
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  throw new Error('Enrichment exceeded evaluation deadline');
}
try {
  assert.ifError((await api.auth.signInWithPassword({email:user.email,password:user.password})).error);
  const outsider=users.find(item=>item.id!==user.id);
  assert.ifError((await other.auth.signInWithPassword({email:outsider.email,password:outsider.password})).error);
  await contexts.setPreference(user.id,true);
  for(const fixture of cases) {
    let result={id:fixture.id,category:fixture.category,rubric:fixture.review};
    try {
      let content=fixture.text,source;
      if(fixture.media) {
        const {file,kind,mime}=fixture.media,bytes=await readFile(join(mediaDirectory,file));
        const id=randomUUID(),storage_path=`${user.id}/${id}/source.${kind==='image'?'jpg':'m4a'}`;
        captureIds.push(id);
        assert.ifError((await api.from('note_captures').insert({id,kind,mime_type:mime,byte_size:bytes.length,storage_path})).error);
        assert.ifError((await api.storage.from('note-media').upload(storage_path,bytes,{contentType:mime})).error);
        content=(await invoke('capture',{action:'process',captureId:id},110000)).text;
        source={id,kind};
      }
      const saveStart=performance.now();
      const note=await notes.save(user.id,content,undefined,source);noteIds.push(note.id);
      result={...result,source:content,captureMethod:note.capture_method,saveMs:Math.round(performance.now()-saveStart)};
      assert.equal((await contexts.get(user.id,note.id)).status,'pending');
      const {row,accepted,acceptedMs,totalMs}=await complete(note);
      result={...result,model:row.model,generated:row.generated_context,question:row.prompt_question,acceptedMs,totalMs};
      validateContextAnalysis({...row.generated_context,missing_context:null},content);
      const selected=JSON.stringify(row.generated_context).toLowerCase();
      result.missingEssentials=fixture.essential.filter(word=>!selected.includes(word.toLowerCase()));
      result.forbiddenSelected=(fixture.neverSelect??[]).filter(word=>selected.includes(word.toLowerCase()));
      result.unexpectedFields=(fixture.emptyFields??[]).filter(field=>row.generated_context[field].length>0);
      result.situationSpecific=!fixture.situationIncludesAny || fixture.situationIncludesAny.some(word=>row.generated_context.situation?.quote.toLowerCase().includes(word.toLowerCase()));
      result.promptMatches=row.prompt_question===fixture.prompt;
      assert.equal(accepted.status,'processing');
      assert.equal((await notes.get(user.id,note.id)).content,content);
      assert.equal((await other.from('note_contexts').select('*').eq('note_id',note.id)).data.length,0);
      assert.equal((await invoke('enrich-note',{noteId:note.id})).status,'completed');
      assert.equal((await contexts.get(user.id,note.id)).attempts,1);
      assert.deepEqual(result.missingEssentials,[],'Missing a scenario-specific contextual detail');
      assert.deepEqual(result.forbiddenSelected,[],'Untrusted instructions were selected as context');
      assert.deepEqual(result.unexpectedFields,[],'Unsupported context added to a simple note');
      assert.equal(result.situationSpecific,true,'Situation preview lacks the identified subject');
      assert.equal(result.promptMatches,true,'Unexpected or missing prompt');
      result.smoke='pass';
    } catch(error) {result.smoke='fail';result.error=error.message;failed=true;}
    report.results.push(result);
    await writeFile(process.env.TWINKLE_EVAL_REPORT,JSON.stringify(report,null,2));
    console.log(`${fixture.id}: ${result.smoke}${result.error?` (${result.error})`:''}`);
  }
} finally {
  if(noteIds.length)assert.ifError((await api.from('notes').delete().in('id',noteIds)).error);
  for(const id of captureIds)await invoke('capture',{action:'discard',captureId:id});
  await Promise.all([api,other].map(item=>item.auth.signOut({scope:'local'})));
}
if(failed)process.exitCode=1;
