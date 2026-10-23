import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createNotesRepository } from '../src/lib/notes-repository.ts';
import { validateResult } from '../supabase/functions/_shared/capture-contract.ts';

// Opt-in: requires two empty, confirmed disposable users and synthetic fixtures.
// This test makes a small number of billed OpenAI requests through the deployed function.
test('live capture: private originals, extraction, transcription, caching, saving, and ownership', {
  skip: !process.env.TWINKLE_TEST_FIXTURES || !process.env.TWINKLE_MEDIA_FIXTURES,
  timeout: 300000,
}, async () => {
  const users=JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES,'utf8'));
  const url=process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key=process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const client=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const a=client(),b=client(),fresh=client();
  const ids=[];
  const notes=[];
  const repo=createNotesRepository(a);
  for (const [api,user] of [[a,users[0]],[b,users[1]],[fresh,users[0]]]) {
    assert.ifError((await api.auth.signInWithPassword({email:user.email,password:user.password})).error);
  }
  async function stage(file,kind,mime,bytesOverride) {
    const bytes=bytesOverride ?? await readFile(join(process.env.TWINKLE_MEDIA_FIXTURES,file));
    const id=randomUUID();ids.push(id);
    const path=`${users[0].id}/${id}/source.${mime==='image/jpeg'?'jpg':mime==='audio/mp4'?'m4a':'webm'}`;
    const row=await a.from('note_captures').insert({id,kind,mime_type:mime,byte_size:bytes.length,storage_path:path}).select().single();
    assert.ifError(row.error);
    assert.ifError((await a.storage.from('note-media').upload(path,bytes,{contentType:mime,upsert:false})).error);
    return row.data;
  }
  async function runCapture(row) {
    const result=await a.functions.invoke('capture',{body:{action:'process',captureId:row.id},timeout:110000});
    if(result.error) {
      const detail=result.error.context instanceof Response ? await result.error.context.json().catch(()=>null) : null;
      throw new Error(detail?.error ?? result.error.message);
    }
    return validateResult(result.data);
  }
  try {
    const unauthorized=await fetch(`${url}/functions/v1/capture`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({action:'process',captureId:randomUUID()})});
    assert.equal(unauthorized.status,401);
    const photo=await stage('printed.jpg','image','image/jpeg');
    assert.ok((await b.storage.from('note-media').download(photo.storage_path)).error);
    assert.ok((await b.from('note_captures').select('*').eq('id',photo.id)).data.length===0);
    assert.ok((await b.functions.invoke('capture',{body:{action:'process',captureId:photo.id}})).error);
    assert.ok((await b.functions.invoke('capture',{body:{action:'discard',captureId:photo.id}})).error);
    assert.ok((await a.from('note_captures').update({status:'ready',result:{text:'fake'}}).eq('id',photo.id)).error);
    assert.ok((await a.storage.from('note-media').upload(photo.storage_path,new Uint8Array([1]),{contentType:'image/jpeg',upsert:true})).error);
    const normal=(text)=>text.toLowerCase().replace(/[^a-z0-9]/g,'');
    const expected='Saturday ideas Buy lemons and fresh bread. Call Maya at 3:30. Keep the original words.';
    const printed=await runCapture(photo);
    assert.equal(normal(printed.text),normal(expected));
    const cached=await runCapture(photo);
    assert.deepEqual(cached,printed);
    assert.equal((await a.from('note_captures').select('attempts').eq('id',photo.id).single()).data.attempts,1);
    const content=`${printed.text}\nReviewed before saving.`;
    const saved=await repo.save(users[0].id,content,undefined,{id:photo.id,kind:'image'});notes.push(saved.id);
    assert.equal(saved.capture_method,'image');assert.equal(saved.source_capture_id,photo.id);
    assert.equal((await repo.save(users[0].id,content,undefined,{id:photo.id,kind:'image'})).id,saved.id);
    assert.equal((await createNotesRepository(fresh).get(users[0].id,saved.id)).content,content);
    assert.ok((await a.functions.invoke('capture',{body:{action:'discard',captureId:photo.id}})).error);
    await a.storage.from('note-media').remove([photo.storage_path]);
    assert.ifError((await a.storage.from('note-media').info(photo.storage_path)).error);

    const handwriting=await stage('handwriting-font.jpg','image','image/jpeg');
    assert.equal(normal((await runCapture(handwriting)).text),normal(expected));
    const blank=await stage('blank.jpg','image','image/jpeg');
    const empty=await runCapture(blank);assert.equal(empty.empty,true);assert.equal(empty.text.trim(),'');
    const audio=await stage('speech.m4a','audio','audio/mp4');
    const transcript=await runCapture(audio);
    for(const phrase of ['lemons','fresh bread','maya','original words']) assert.ok(transcript.text.toLowerCase().includes(phrase));
    const audioNote=await repo.save(users[0].id,transcript.text,undefined,{id:audio.id,kind:'audio'});notes.push(audioNote.id);
    assert.equal(audioNote.capture_method,'audio');
    assert.equal((await createNotesRepository(fresh).get(users[0].id,audioNote.id)).content,transcript.text);
    const forged=await stage(null,'image','image/jpeg',new TextEncoder().encode('not a JPEG'));
    await assert.rejects(runCapture(forged),/contents do not match/);
    assert.ifError((await a.storage.from('note-media').info(forged.storage_path)).error);
    assert.equal((await a.from('note_captures').select('status').eq('id',forged.id).single()).data.status,'failed');
    console.log('Live evaluation passed: printed text, synthetic handwriting font, blank image, and synthesized English speech. This is not a real handwriting/accent benchmark.');
  } finally {
    if(notes.length) assert.ifError((await a.from('notes').delete().in('id',notes)).error);
    for(const id of ids) await a.functions.invoke('capture',{body:{action:'discard',captureId:id}});
    await Promise.all([a,b,fresh].map(api=>api.auth.signOut({scope:'local'})));
  }
});
