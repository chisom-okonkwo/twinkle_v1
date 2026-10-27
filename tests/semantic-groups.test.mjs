import assert from'node:assert/strict';import test from'node:test';
import{validateSemanticGroups,validateSemanticVerification,SEMANTIC_GROUP_INSTRUCTIONS}from'../supabase/functions/_shared/semantic-groups.ts';
import{analyzeSemanticGroups}from'../supabase/functions/_shared/semantic-ai.ts';
const make=(id,title,content)=>({id,hash:id,title,content,user_context:'',answer:'',source_name:'',source_description:'',source_type:null});
const notes=[make('a','Dream — old school','Same familiar corridor.'),make('b','Dream journal','I returned to the street I knew as a child.'),make('c','A civil-rights quotation','The phrase I have a dream occurs in a public speech.')];
const group=()=>({existing_id:null,label:'Dreams',description:'The notes record remembered scenes from dreams.',members:notes.slice(0,2).map(n=>({id:n.id,field:'title',quote:n.title}))});
test('broad subjects and short original titles can support groups without self-rated scores or a three-note universal gate',()=>{
 const result=validateSemanticGroups({groups:[group()]},notes,[['a','b','c']],[]);assert.equal(result.groups[0].label,'Dreams');assert.equal(result.groups[0].members.length,2);assert.equal(result.groups[0].members[0].quote,notes[0].title);
 assert.match(SEMANTIC_GROUP_INSTRUCTIONS,/need not share an argument/);assert.match(SEMANTIC_GROUP_INSTRUCTIONS,/fictional/);assert.match(SEMANTIC_GROUP_INSTRUCTIONS,/Short titles/);
});
test('every member must have verified source text and belong to one coherent core',()=>{
 for(const patch of [{id:'foreign'},{field:'generated_context'},{quote:'A fabricated hidden desire'},{quote:'Dre'},{score:90}]){
  const g=group();Object.assign(g.members[0],patch);assert.throws(()=>validateSemanticGroups({groups:[g]},notes,[['a','b']],[]),/invalid_output/);
 }
 assert.throws(()=>validateSemanticGroups({groups:[group()]},notes,[['a','c'],['b','c']],[]),/invalid_output/);
 const g=group();g.members[1]={...g.members[0]};assert.throws(()=>validateSemanticGroups({groups:[g]},notes,[['a','b']],[]));
 assert.throws(()=>validateSemanticGroups({groups:[{...group(),members:group().members.slice(0,1)}]},notes,[['a','b']],[]));
});
test('psychological dream interpretation, unsupported trends and invented numerical summaries are rejected',()=>{
 for(const label of ['Your subconscious desires','Dreams symbolize a diagnosis','Your personality'])assert.throws(()=>validateSemanticGroups({groups:[{...group(),label}]},notes,[['a','b']],[]));
 for(const description of ['You are becoming more confident.','This appears in 5 notes.','Your interest is increasing.'])assert.throws(()=>validateSemanticGroups({groups:[{...group(),description}]},notes,[['a','b']],[]));
});
test('known identities keep exact meaning, and grounded qualified statements retain uncertainty',()=>{
 const known=[{id:'theme',label:'Dreams',description:group().description,dismissed:false}];
 assert.equal(validateSemanticGroups({groups:[{...group(),existing_id:'theme'}]},notes,[['a','b']],known).groups[0].existing_id,'theme');
 assert.throws(()=>validateSemanticGroups({groups:[{...group(),existing_id:'theme',label:'Secret desires'}]},notes,[['a','b']],known));
});
test('validation uses strict JSON, original field text, store:false and measured usage; failure is not an empty success',async()=>{
 let usage;
 const result=await analyzeSemanticGroups(notes,[['a','b','c']],[],{key:'server-only',model:'gpt-6-luna'},u=>{usage=u;},async(_,init)=>{
  const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.match(body.instructions,/UNTRUSTED/);assert.equal(body.input[0].content[0].text.includes('embedding'),false);
  return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:20},output:[{content:[{type:'output_text',text:JSON.stringify(body.text.format.name==='verified_theme_members'?{decisions:[{group_id:'g0',label_supported:true,members:[{id:'n0',supported:true},{id:'n1',supported:true}]}]}:{groups:[{...group(),members:group().members.map((m,i)=>({...m,id:`n${i}`}))}]})}]}]});
 });assert.equal(result.groups.length,1);assert.deepEqual(usage,{input_tokens:10,output_tokens:20});
 await assert.rejects(()=>analyzeSemanticGroups(notes,[['a','b']],[],{key:'x',model:'x'},()=>{},async()=>new Response('',{status:503})),/provider/);
 assert.deepEqual(validateSemanticGroups({groups:[]},notes,[['a','b']],[]),{groups:[]});
});

test('independent verification must cover every member and suppress unsupported attachments',()=>{
 const g={...group(),members:[...group().members,{id:'c',field:'content',quote:notes[2].content}]};
 const decisions={decisions:[{group_id:'g0',label_supported:true,members:[{id:'a',supported:true},{id:'b',supported:true},{id:'c',supported:false}]}]};
 const verified=validateSemanticVerification(decisions,[g]);assert.deepEqual(verified.groups[0].members.map(m=>m.id),['a','b']);assert.equal(verified.verification.rejected_members,1);
 decisions.decisions[0].members.pop();assert.throws(()=>validateSemanticVerification(decisions,[g]),/coverage/);
});

test('model input and exact-evidence normalization agree for imported Unicode spacing',async()=>{
 const source=[{...notes[0],content:'A\u00a0familiar corridor.'},notes[1]];
 const localGroup={...group(),members:[{id:'n0',field:'content',quote:source[0].content},{id:'n1',field:'title',quote:source[1].title}]};
 const result=await analyzeSemanticGroups(source,[['a','b']],[],{key:'test',model:'test'},()=>{},async(_,init)=>{
 const body=JSON.parse(init.body),input=JSON.parse(body.input[0].content[0].text);
 assert.equal(input.notes[0].content,source[0].content);
 const response=body.text.format.name==='verified_theme_members'?{decisions:[{group_id:'g0',label_supported:true,members:[{id:'n0',supported:true},{id:'n1',supported:true}]}]}:{groups:[localGroup]};
 return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(response)}]}]});
 });assert.equal(result.groups[0].members[0].quote,source[0].content);assert.equal(source[0].content,'A\u00a0familiar corridor.');
});
