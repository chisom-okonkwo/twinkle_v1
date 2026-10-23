import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureUploaded, processWithRecovery, uploadedSize, withDeadline } from '../src/lib/capture-network.ts';

test('Storage v2 top-level size wins over custom metadata', () => {
  assert.equal(uploadedSize({size:123,metadata:{size:999}}),123);
  assert.equal(uploadedSize({metadata:{size:123}}),123);
  assert.equal(uploadedSize(null),-1);
});
test('a completed upload with a lost response is reused without uploading again', async () => {
  await ensureUploaded(123,{info:async()=>({size:123}),upload:async()=>assert.fail('must reuse uploaded object')});
});
test('an upload that commits then loses its response succeeds through the info check', async () => {
  let exists=false,uploads=0;
  await ensureUploaded(123,{info:async()=>exists?{size:123}:null,upload:async()=>{uploads++;exists=true;throw new Error('response lost');}});
  assert.equal(uploads,1);
});
test('one transient failure is retried, and repeated failures stop', async () => {
  let uploads=0;
  await ensureUploaded(123,{info:async()=>null,upload:async()=>{if(++uploads===1)throw new Error('connection lost');}});
  assert.equal(uploads,2);
  uploads=0;
  await assert.rejects(ensureUploaded(123,{info:async()=>null,upload:async()=>{uploads++;throw new Error('offline');}}),/connection and retry/);
  assert.equal(uploads,2);
});
test('permission failure and cancellation do not trigger repeated uploads', async () => {
  let uploads=0;
  await assert.rejects(ensureUploaded(123,{info:async()=>null,upload:async()=>{uploads++;throw new Error('Upload not permitted. Please sign in again.');}}),/sign in/);
  assert.equal(uploads,1);
  const controller=new AbortController();controller.abort();
  await assert.rejects(ensureUploaded(123,{info:async()=>null,upload:async()=>assert.fail()},controller.signal),/stopped/);
});
test('deadlines and parent cancellation abort stalled requests, including body reads', async () => {
  const stalled=async(signal)=>new Promise((_,reject)=>{
    if(signal.aborted)reject(new Error('aborted'));
    else signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  });
  await assert.rejects(withDeadline(stalled,15),/timed out|aborted/);
  await assert.rejects(withDeadline(async()=>new Promise(()=>{}),15),/timed out/);
  const controller=new AbortController();
  const pending=withDeadline(stalled,10000,controller.signal);controller.abort();
  await assert.rejects(pending,/stopped|aborted/);
  assert.equal(await withDeadline(async()=>123,100),123);
});
test('cached results skip the model call, including recovery after a lost function response', async () => {
  const result={text:'Original words',empty:false,warnings:[]};
  assert.equal(await processWithRecovery({readReady:async()=>result,process:async()=>assert.fail('must not bill again')}),result);
  let ready=false,calls=0;
  assert.equal(await processWithRecovery({readReady:async()=>ready?result:null,process:async()=>{calls++;ready=true;throw new Error('response lost');}}),result);
  assert.equal(calls,1);
  await assert.rejects(processWithRecovery({readReady:async()=>null,process:async()=>{throw new Error('processing failed');}}),/processing failed/);
});
