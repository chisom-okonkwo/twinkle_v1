import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_SOURCE, suggestSource, validateSource } from '../supabase/functions/_shared/source-contract.ts';
import { validateLinks, validateTerms } from '../supabase/functions/_shared/related-contract.ts';
import { relatedLinks, relatedTerms } from '../supabase/functions/_shared/related-ai.ts';
const origin = { id: 'origin', content: "Creativity doesn't always come from inspiration. Sometimes it comes from showing up consistently.", context: '', source: null };
const target = { id: 'target', content: "I've been thinking about how discipline might be the foundation of creative work.", context: '', source: null };
const link = { id: target.id, explanation: 'Both notes explore how consistency and discipline support creativity.', origin_quote: 'Sometimes it comes from showing up consistently.', related_quote: target.content, score: 95 };
test('optional attribution accepts all source types and removal without changing the note', () => {
  for (const source_type of ['book','article','conversation','project','other']) assert.equal(validateSource({ source_type, name: '  Atlas  ', url: '', description: '  Context ' }).name, 'Atlas');
  assert.deepEqual(validateSource({ ...EMPTY_SOURCE, name: 'old' }), EMPTY_SOURCE);
  assert.deepEqual(validateSource({ source_type:'book', name:'Saved title', url:'', description:'', note_id:'immutable-id', user_id:'immutable-owner', version:7 }), { source_type:'book', name:'Saved title', url:'', description:'' });
  assert.throws(() => validateSource({ ...EMPTY_SOURCE, source_type: 'book' }), /name or web link/);
});
test('source links reject dangerous protocols, embedded credentials, whitespace and oversized values', () => {
  for (const url of ['javascript:alert(1)','file:///etc/passwd','https://user:secret@example.com','https://example.com/a b']) assert.throws(() => validateSource({ ...EMPTY_SOURCE, source_type: 'article', url }));
  assert.throws(() => validateSource({ source_type: 'book', name: 'x'.repeat(301), url: '', description: '' }));
  assert.equal(validateSource({ source_type: 'article', name: '', url: 'https://example.com/page', description: '' }).url, 'https://example.com/page');
});
test('source suggestions reuse literal labeled cues and never invent missing references', () => {
  assert.equal(suggestSource('Book: Atomic Habits\nA small habit helps.' ).name, 'Atomic Habits');
  assert.equal(suggestSource('Website: https://example.com/essay').url, 'https://example.com/essay');
  assert.equal(suggestSource('I read something useful in that book.'), null);
  assert.equal(suggestSource('I spoke to Maya about creativity.'), null);
  assert.equal(suggestSource('Website: javascript:alert(1)').source_type, 'article'); // a literal name, never an executable link
});
test('related output validates candidate IDs, exact evidence, duplicates and strong score thresholds', () => {
  assert.deepEqual(validateLinks({ links: [link] }, origin, [target]), [link]);
  for (const bad of [{...link,id:'outsider'},{...link,origin_quote:'invented trip'},{...link,score:70},{...link,explanation:'x'.repeat(241)}]) assert.throws(() => validateLinks({links:[bad]},origin,[target]));
  assert.throws(() => validateLinks({links:[link,link]},origin,[target]));
  assert.throws(() => validateLinks({links:[{...link,id:origin.id}]},origin,[origin]));
  assert.throws(() => validateLinks({links:[link]},origin,[{...target,content:origin.content}]));
  assert.deepEqual(validateLinks({links:[]},origin,[target]),[]);
});
test('quoted evidence preserves speculation and reported speakers, and rejects substring tricks', () => {
  const qualified={...origin,content:'Maya said she might leave the Atlas project if the trial fails.'};
  const result=validateLinks({links:[{...link,origin_quote:'leave the Atlas project'}]},qualified,[target]);
  assert.equal(result[0].origin_quote,qualified.content);
  assert.throws(() => validateLinks({links:[{...link,origin_quote:'happy'}]},{...origin,content:'I am unhappy.'},[target]));
});
test('search expansion is bounded, deduplicated and rejects malformed model data', () => {
  assert.deepEqual(validateTerms({terms:[' creativity ','discipline','discipline']}),['creativity','discipline']);
  for (const terms of [Array(13).fill('word'),['x'.repeat(81)],[''],[42]]) assert.throws(()=>validateTerms({terms}));
});
function provider(value, inspect) { return async (_url, init) => { inspect?.(JSON.parse(init.body)); return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]}); }; }
test('AI uses server Responses strict JSON, untrusted data and no provider storage', async () => {
  const terms=await relatedTerms(origin,{key:'private-server-key',model:'gpt-6-luna'},provider({terms:['creativity','discipline']}, body=>{
    assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.match(body.instructions,/UNTRUSTED/);assert.equal(body.model,'gpt-6-luna');
  }));
  assert.equal(terms.length,2);
  assert.equal((await relatedLinks(origin,[target],{key:'server',model:'gpt-6-luna'},provider({links:[link]}))).length,1);
});
test('provider failures and refusals fail closed; empty candidates avoid a paid call', async () => {
  await assert.rejects(relatedTerms(origin,{key:'server',model:'test'},async()=>new Response('',{status:503})),/provider/);
  await assert.rejects(relatedTerms(origin,{key:'server',model:'test'},async()=>Response.json({status:'incomplete',output:[]})),/invalid_result/);
  await assert.rejects(relatedLinks(origin,[target],{key:'server',model:'test'},provider({links:[{...link,origin_quote:'fabricated'}]})),/invalid_result/);
  assert.deepEqual(await relatedLinks(origin,[],{key:'server',model:'test'},async()=>{throw Error('Should not call');}),[]);
});
