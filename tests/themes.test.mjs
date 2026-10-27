import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { validateThemeGroups } from './legacy/themes-contract.ts';
import { analyzeThemes } from './legacy/themes-ai.ts';
import { createThemesRepository } from '../src/lib/themes-repository.ts';
const origin={id:'origin',content:'Creativity can grow through consistent practice even without inspiration.',context:'Creative practice',source:null};
const candidates=[{id:'one',content:'Building creative habits helps me make art instead of waiting for motivation.',context:'Habits for making art',source:null},{id:'two',content:'Discipline supports creative work by making room for regular practice.',context:'Creative discipline',source:null}];
const group=()=>({existing_id:null,label:'Creativity through consistency',description:'These notes explore how regular practice supports creative work.',origin_quote:origin.content,members:candidates.map(n=>({id:n.id,quote:n.content,score:95}))});
const validate=(g=group(),pool=candidates,known=[])=>validateThemeGroups({groups:[g]},origin,pool,known);
const provider=(value,inspect)=>async(url,init)=>{inspect?.(url,JSON.parse(init.body));return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});};
test('recurring groups require at least three distinct notes with grounded evidence, without estimated counts',()=>{
 const result=validate();assert.equal(result[0].members.length,3);assert.equal(result[0].members[0].id,origin.id);assert.equal(result[0].note_count,undefined);
 assert.throws(()=>validate({...group(),members:group().members.slice(0,1)}),/invalid_result/);
 assert.deepEqual(validateThemeGroups({groups:[]},origin,candidates,[]),[]);
});
test('unknown IDs, repeated notes/content, weak scores and fabricated or partial-word evidence are rejected',()=>{
 for(const bad of [{id:'outsider'},{id:origin.id},{score:89},{score:101},{quote:'An invented outcome.'},{quote:'art'}]){
  const g=group();Object.assign(g.members[0],bad);assert.throws(()=>validate(g),/invalid_result/);
 }
 const repeated=group();repeated.members[1]={...repeated.members[0]};assert.throws(()=>validate(repeated));
 assert.throws(()=>validate(group(),[candidates[0],{...candidates[1],content:candidates[0].content}]));
});
test('specific labels, no invented trends/personality claims, and sensitive-data suppression are enforced',()=>{
 for(const label of ['Personal growth','Life','Work','Your personality','You are an anxious person'])assert.throws(()=>validate({...group(),label}));
 for(const description of ['You are becoming more confident.','This theme is increasing.','You explored this in 8 notes.'])assert.throws(()=>validate({...group(),description}));
 const sensitive={...candidates[0],content:'Therapy helped me explore creative habits and personal trauma.'};
 const g=group();g.members[0].quote=sensitive.content;assert.throws(()=>validate(g,[sensitive,candidates[1]]));
});
test('reported or uncertain emotional evidence retains the whole qualified sentence',()=>{
 const original={...origin,content:'Maya said she might share an unfinished creative draft if the workshop feels welcoming.'};
 const g=group();g.origin_quote='share an unfinished creative draft';
 assert.equal(validateThemeGroups({groups:[g]},original,candidates,[])[0].members[0].quote,original.content);
});
test('known labels retain stable identity and dismissals cannot be silently revived',()=>{
 const known=[{id:'theme',label:group().label,description:group().description,dismissed:false}];
 assert.equal(validate({...group(),existing_id:'theme'},candidates,known)[0].existing_id,'theme');
 assert.throws(()=>validate({...group(),existing_id:'foreign'},candidates,known));
 assert.throws(()=>validate({...group(),existing_id:'theme',label:'A different idea'},candidates,known));
 assert.deepEqual(validate({...group(),existing_id:'theme'},candidates,[{...known[0],dismissed:true}]),[]);
});
test('one note may support separate themes while duplicate labels and excess groups fail',()=>{
 const second={...group(),label:'Making room for creative work'};
 assert.equal(validateThemeGroups({groups:[group(),second]},origin,candidates,[]).length,2);
 assert.throws(()=>validateThemeGroups({groups:[group(),group()]},origin,candidates,[]));
 assert.throws(()=>validateThemeGroups({groups:[group(),second,second]},origin,candidates,[]));
});
test('theme AI extends FR-15 Responses calls with strict JSON, no provider storage and untrusted input',async()=>{
 const groups=await analyzeThemes(origin,candidates,[],{key:'server-test',model:'gpt-6-luna'},provider({groups:[group()]},(url,body)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.max_output_tokens,4800);assert.match(body.instructions,/UNTRUSTED/);assert.match(body.instructions,/statistics/);
 }));assert.equal(groups.length,1);
 await assert.rejects(()=>analyzeThemes(origin,candidates,[],{key:'test',model:'test'},async()=>new Response('',{status:503})),/provider/);
 await assert.rejects(()=>analyzeThemes(origin,candidates,[],{key:'test',model:'test'},async()=>Response.json({status:'incomplete',output:[]})),/invalid_result/);
 assert.deepEqual(await analyzeThemes(origin,[],[],{key:'test',model:'test'},async()=>assert.fail('No paid call for fewer than three notes')),[]);
});
test('reads use owner-free bounded RPCs and feedback cannot overwrite generated membership or source notes',async()=>{
 const calls=[];
 const client=createClient('https://test.supabase.co','public-test',{auth:{persistSession:false},global:{fetch:async(url,init)=>{
  calls.push({url:String(url),body:JSON.parse(init.body),method:init.method});
  const data=String(url).includes('note_theme_snapshot')?{status:'ready',checked:3,total:3,pending:0,themes:[]}:String(url).includes('read_note_theme_members')?[]:{id:'theme'};
  return Response.json(data);
 }}});
 const repo=createThemesRepository(client);
 assert.equal((await repo.snapshot('recent')).checked,3);assert.deepEqual(calls[0].body,{period:'recent'});
 await repo.members('theme','all',20);assert.deepEqual(calls[1].body,{target_id:'theme',period:'all',page_offset:20});
 await repo.feedback('owner','theme',{user_label:'My practice'});assert.match(calls[2].url,/user_id=eq.owner/);assert.deepEqual(calls[2].body,{user_label:'My practice'});
 await repo.feedback('owner','theme',{dismissed:true});assert.deepEqual(calls[3].body,{dismissed:true});
 await assert.rejects(()=>repo.feedback('owner','theme',{user_label:'\n'}));
});

test('collection analysis finds groups without an origin or lexical candidate gate and checks every supplied note together',async()=>{
 const {analyzeThemeCollection}=await import('./legacy/themes-ai.ts');
 const collection=[...candidates,origin,{id:'unrelated',content:'The bicycle wheel needs a different size of brake cable before the repair.',context:'',source:null}];
 const proposal={existing_id:null,label:group().label,description:group().description,members:[origin,...candidates].map(n=>({id:n.id,quote:n.content,score:95}))};
 const result=await analyzeThemeCollection(collection,collection.map(n=>n.id),[],{key:'test',model:'test'},provider({groups:[proposal]},(_,body)=>{
  const input=JSON.parse(body.input[0].content[0].text);assert.equal(input.collection.length,4);assert.equal(input.focus_ids.length,4);assert.equal(body.max_output_tokens,10000);assert.match(body.instructions,/Compare ALL/);
 }));
 assert.equal(result.length,1);assert.equal(result[0].members.length,3);
 assert.ok(!result[0].members.some(n=>n.id==='unrelated'));
 await assert.rejects(()=>analyzeThemeCollection(collection,['unrelated'],[],{key:'test',model:'test'},provider({groups:[proposal]})),/invalid_result/);
 await assert.rejects(()=>analyzeThemeCollection([...collection,...Array(45).fill(origin)],[origin.id],[],{key:'test',model:'test'},()=>assert.fail()),/invalid_collection/);
 assert.deepEqual(await analyzeThemeCollection([origin],[origin.id],[],{key:'test',model:'test'},()=>assert.fail()),[]);
});
