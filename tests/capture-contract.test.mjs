import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSignature, MAX_MEDIA_BYTES, validateMedia, validateResult } from '../supabase/functions/_shared/capture-contract.ts';
import { extractMedia } from '../supabase/functions/_shared/openai.ts';

const config = { key: 'test-only', visionModel: 'gpt-6-luna', audioModel: 'gpt-transcribe' };
test('media validation rejects empty, oversized, mismatched and unsupported files', () => {
  for (const size of [0, -1, MAX_MEDIA_BYTES + 1, 0.5, NaN]) assert.throws(() => validateMedia('image', 'image/jpeg', size));
  assert.throws(() => validateMedia('image', 'audio/mp4', 20));
  assert.throws(() => validateMedia('audio', 'text/html', 20));
  assert.doesNotThrow(() => validateMedia('audio', 'audio/mp4', 20));
  assert.doesNotThrow(() => validateMedia('audio', 'audio/webm', 20));
});
test('server checks media signatures rather than trusting MIME or file names', () => {
  assert.doesNotThrow(() => checkSignature(new Uint8Array([255,216,255,0]), 'image/jpeg'));
  assert.doesNotThrow(() => checkSignature(new Uint8Array([0,0,0,20,102,116,121,112]), 'audio/mp4'));
  assert.doesNotThrow(() => checkSignature(new Uint8Array([26,69,223,163]), 'audio/webm'));
  assert.throws(() => checkSignature(new TextEncoder().encode('not an image'), 'image/jpeg'));
});
test('model outputs must be predictable and consistent, including empty media', () => {
  assert.deepEqual(validateResult({text:'',empty:true,warnings:['No readable text']}), {text:'',empty:true,warnings:['No readable text']});
  for (const value of [null, {}, {text:'text',empty:true,warnings:[]}, {text:'',empty:false,warnings:[]}, {text:'text',empty:false,warnings:[1]}, {text:'a'.repeat(100001),empty:false,warnings:[]}]) assert.throws(() => validateResult(value));
});
test('photo extraction uses the requested model, private inline input, strict JSON and store:false', async () => {
  const result = await extractMedia('image', new Uint8Array([255,216,255]), 'image/jpeg', config, async (url, request) => {
    assert.equal(url,'https://api.openai.com/v1/responses');
    const body=JSON.parse(request.body);
    assert.equal(body.model,'gpt-6-luna');
    assert.equal(body.store,false);
    assert.equal(body.text.format.strict,true);
    assert.match(body.instructions,/Do not summarize/);
    assert.match(body.input[0].content[1].image_url,/^data:image\/jpeg;base64,/);
    return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({text:'Original\nwords',empty:false,warnings:[]})}]}]});
  });
  assert.equal(result.text,'Original\nwords');
});
test('incomplete or malformed image output is never accepted as a note', async () => {
  for (const response of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'output_text',text:'not JSON'}]}]}]) {
    await assert.rejects(extractMedia('image',new Uint8Array([255,216,255]),'image/jpeg',config,async()=>Response.json(response)));
  }
});
test('audio uses completed-file transcription without forced language or translation', async () => {
  const result=await extractMedia('audio',new Uint8Array([0,0,0,20,102,116,121,112]),'audio/mp4',config,async(url,request)=>{
    assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(request.body.get('model'),'gpt-transcribe');
    assert.equal(request.body.has('language'),false);
    assert.equal(request.body.has('languages'),false);
    assert.equal(request.body.get('file').name,'source.m4a');
    assert.equal(request.headers['Content-Type'],undefined);
    return Response.json({text:'Bonjour, gardez mes mots.',languages:[{code:'fr'}]});
  });
  assert.equal(result.text,'Bonjour, gardez mes mots.');
});
test('empty speech returns a warning rather than fabricated note text', async () => {
  const result=await extractMedia('audio',new Uint8Array(),'audio/mp4',config,async()=>Response.json({text:''}));
  assert.equal(result.empty,true);assert.equal(result.text,'');assert.ok(result.warnings.length);
});
test('provider errors provide retry guidance without leaking provider payloads or credentials', async () => {
  await assert.rejects(extractMedia('audio',new Uint8Array(),'audio/mp4',config,async()=>Response.json({error:'private provider detail'},{status:429})),/source is safe/);
  await assert.rejects(extractMedia('image',new Uint8Array(),'image/jpeg',config,async()=>Response.json({error:'secret'},{status:401})),/server configuration/);
});
