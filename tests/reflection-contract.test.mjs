import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {validateComparisons,validateQuestion,validateVerification,COMPARISON_INSTRUCTIONS,QUESTION_INSTRUCTIONS} from '../supabase/functions/_shared/reflection-contract.ts';
import {analyzeReflection} from '../supabase/functions/_shared/reflection-ai.ts';
import {createReflectionsRepository} from '../src/lib/reflections-repository.ts';
const fixture=JSON.parse(await readFile(new URL('./fixtures/reflection-evaluation.json',import.meta.url),'utf8'));
const notes=(c=fixture.cases[0])=>[{id:'a',title:'Earlier thought',content:c.early,captured_at:'2020-01-10T12:00:00Z'},{id:'b',title:'Later thought',content:c.late,captured_at:'2026-10-10T12:00:00Z'}];
const comparison=(c=fixture.cases[0])=>({kind:c.kind,earlier_id:'a',later_id:'b',earlier_quote:c.early,later_quote:c.late,observation:c.observation});
const response=value=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
test('documented changes, continuity and explicitly unresolved questions retain exact original evidence across years',()=>{
 for(const c of fixture.cases.filter(c=>c.kind))assert.deepEqual(validateComparisons({comparisons:[comparison(c)]},notes(c)),[comparison(c)]);
 assert.deepEqual(validateComparisons({comparisons:[]},notes()),[]);
 assert.match(COMPARISON_INSTRUCTIONS,/absence of an outcome is NOT evidence/);assert.match(COMPARISON_INSTRUCTIONS,/UNTRUSTED DATA/);assert.match(QUESTION_INSTRUCTIONS,/quoted advice/);
});
test('foreign notes, reversed chronology, unknown dates, duplicate content/pairs, fabricated quotes and growth narratives fail closed',()=>{
 for(const patch of [{earlier_id:'other-user'},{later_id:'a'},{earlier_quote:'I already got the internship.'},{observation:'You have grown and finally achieved success.'},{kind:'diagnosis'},{extra:'field'}])assert.throws(()=>validateComparisons({comparisons:[{...comparison(),...patch}]},notes()));
 assert.throws(()=>validateComparisons({comparisons:[comparison()]},notes().map((n,i)=>i?{...n,captured_at:null}:n)));
 assert.throws(()=>validateComparisons({comparisons:[comparison()]},notes().map((n,i)=>i?{...n,captured_at:'2020-01-11T12:00:00Z'}:n)));
 assert.throws(()=>validateComparisons({comparisons:[comparison(),comparison()]},notes()));
 assert.throws(()=>validateComparisons({comparisons:[comparison()]},notes(),'not-present'));
 const n=notes();n[1].content=n[0].content;assert.throws(()=>validateComparisons({comparisons:[comparison()]},n));
});
test('questions are optional, one concise question, body-grounded and non-prescriptive',()=>{
 const n=notes()[0];assert.equal(validateQuestion({prompt:null},n),null);
 const p={question:fixture.cases[0].question,quote:n.content};assert.deepEqual(validateQuestion({prompt:p},n),p);
 for(const question of ['Why haven’t you finally achieved your goal?','How have you overcome this?','How are you? What now?'])assert.throws(()=>validateQuestion({prompt:{...p,question}},n));
 assert.throws(()=>validateQuestion({prompt:{...p,quote:'This was never written.'}},n));
});
test('independent verification suppresses false comparisons; no extra calls for no supported proposal',async()=>{
 let calls=0;
 const result=await analyzeReflection(notes(),'note','a',{key:'test-only',model:'gpt-6-luna'},async(_,init)=>{
  calls++;const request=JSON.parse(init.body);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);
  return response(calls===1?{comparisons:[{...comparison(),earlier_id:'n0',later_id:'n1'}]}:{supported:[false]});
 });assert.deepEqual(result,[]);assert.equal(calls,2);
 calls=0;assert.deepEqual(await analyzeReflection(notes(),'theme','theme',{key:'test-only',model:'gpt-6-luna'},async()=>{calls++;return response({comparisons:[]});}),[]);assert.equal(calls,1);
 assert.throws(()=>validateVerification({supported:[true]},2));assert.throws(()=>validateVerification({supported:['true']},1));
});
test('approved evidence maps only to original IDs; provider failures never become empty success',async()=>{
 let calls=0;const result=await analyzeReflection(notes(),'note','a',{key:'test-only',model:'gpt-6-luna'},async()=>response(++calls===1?{comparisons:[{...comparison(),earlier_id:'n0',later_id:'n1'}]}:{supported:[true]}));
 assert.deepEqual(result,[comparison()]);
 await assert.rejects(()=>analyzeReflection(notes(),'note','a',{key:'test-only',model:'x'},async()=>new Response('',{status:503})),/provider/);
 await assert.rejects(()=>analyzeReflection(notes(),'note','a',{key:'test-only',model:'x'},async()=>Response.json({status:'incomplete',output:[]})),/invalid/);
});
test('authored responses use their own transaction; API failure preserves the caller draft',async()=>{
 let called=0;const repo=createReflectionsRepository({rpc:async(name,args)=>{called++;assert.equal(name,'answer_reflective_prompt');assert.deepEqual(args,{prompt_id:'p',body:'My current perspective.'});return {data:null,error:{code:'network'}};}});
 await assert.rejects(()=>repo.answer('p','   '));assert.equal(called,0);
 await assert.rejects(()=>repo.answer('p','My current perspective.'),/Keep your text here/);assert.equal(called,1);
});

test('reflective questions receive newer related evidence rather than asking for an already documented decision',async()=>{
 const source=notes();source[1].content='I decided to apply and submitted my first internship application.';
 let calls=0;
 assert.equal(await analyzeReflection(source,'prompt','a',{key:'test-only',model:'gpt-6-luna'},async(_,init)=>{
  calls++;const request=JSON.parse(init.body),input=JSON.parse(request.input[0].content[0].text);
  assert.equal(input.note.id,'n0');assert.equal(input.related_notes[0].content,source[1].content);
  assert.match(request.instructions,/already explicitly recorded/);
  return response({prompt:null});
 }),null);assert.equal(calls,1);
});
