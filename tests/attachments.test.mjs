import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { appendCaptureText, createAttachmentsRepository } from '../src/lib/attachments-repository.ts';
import { NoteConflictError } from '../src/lib/notes-repository.ts';
function fixture(result, status=200) {
 const requests=[];
 const client=createClient('https://test.supabase.co','public-test',{auth:{persistSession:false},global:{fetch:async(url,init)=>{requests.push({url:String(url),body:JSON.parse(init.body),method:init.method});return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});}}});
 return {repo:createAttachmentsRepository(client),requests};
}
test('reviewed capture text appends without altering original words, whitespace or formatting',()=>{
 const original='  # My thought\r\nKeep **this** wording. 🌻\n';
 const reviewed='## Reviewed text\n- A detail\n- Another detail\n';
 assert.equal(appendCaptureText(original,reviewed),original+'\n\n'+reviewed);
 assert.equal(appendCaptureText(original,''),original);
 assert.equal(appendCaptureText(original,' \n'),original);
 assert.equal(appendCaptureText('',reviewed),reviewed);
 assert.throws(()=>appendCaptureText('a'.repeat(99999),'more'),/100,000/);
});
test('new mixed-media save is one atomic POST, with a stable note id and no caller owner',async()=>{
 const {repo,requests}=fixture({id:'note',content:'Original\n\nReviewed'});
 await repo.save('note','Original\n\nReviewed',['photo','audio']);
 assert.deepEqual(requests,[{url:'https://test.supabase.co/rest/v1/rpc/save_note_with_attachments',method:'POST',body:{target_id:'note',body:'Original\n\nReviewed',capture_ids:['photo','audio']}}]);
});
test('existing note edits/removals carry the original optimistic version and full remaining set',async()=>{
 const {repo,requests}=fixture({id:'note',content:'Original remains'});
 await repo.save('note','Original remains',['audio'],'2026-01-01T00:00:00Z');
 assert.equal(requests[0].body.expected_updated_at,'2026-01-01T00:00:00Z');
 assert.deepEqual(requests[0].body.capture_ids,['audio']);
});
test('blank notes, duplicate source ids and excessive attachments are rejected before requests',async()=>{
 const {repo,requests}=fixture({});
 await assert.rejects(repo.save('note',' ',[]),/Write something/);
 await assert.rejects(repo.save('note','Text',['photo','photo']),/10 different/);
 await assert.rejects(repo.save('note','Text',Array.from({length:11},(_,i)=>String(i))),/10 different/);
 assert.equal(requests.length,0);
});
test('conflicts retain the established non-overwriting conflict behavior',async()=>{
 for(const response of [{code:'P0001',message:'NOTE_CONFLICT'},{code:'23505',message:'Already inserted'}]){
  const {repo}=fixture(response,400);
  await assert.rejects(repo.save('note','Text',['photo'],'old'),NoteConflictError);
 }
});
test('attachment reads derive the user from authentication rather than accepting an owner id',async()=>{
 const data=[{capture_id:'photo',kind:'image',created_at:'2026-01-01'}];
 const {repo,requests}=fixture(data); assert.deepEqual(await repo.list('note'),data);
 assert.deepEqual(requests[0].body,{target_id:'note'});
});
test('a verified media-only note needs no invented text and preserves its capture origin',async()=>{
 const {repo,requests}=fixture({id:'note',content:'',capture_method:'image',has_attachments:true});
 const saved=await repo.save('note','',['photo'],undefined,undefined,'photo');
 assert.equal(saved.content,'');assert.equal(saved.capture_method,'image');
 assert.equal(requests[0].body.initial_capture_id,'photo');assert.equal(requests[0].body.body,'');
});

test('mixed-media title edits are included in the same atomic save, with deliberate clearing',async()=>{
 for(const title of ['A photo and recording','']) {
  const {repo,requests}=fixture({id:'note',title,content:'Existing words'});
  await repo.save('note','Existing words',['photo','audio'],'2026-01-01T00:00:00Z',undefined,undefined,title);
  assert.equal(requests[0].body.note_title,title);
  assert.equal(requests[0].body.body,'Existing words');
  assert.deepEqual(requests[0].body.capture_ids,['photo','audio']);
  assert.equal(requests.length,1);
 }
});
