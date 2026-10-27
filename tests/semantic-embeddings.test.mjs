import assert from 'node:assert/strict';import test from 'node:test';
import{embedNotes,EMBEDDING_DIMENSIONS,EMBEDDING_MODEL}from'../supabase/functions/_shared/semantic-embeddings.ts';
import{retrySemanticWrite}from'../supabase/functions/_shared/semantic-retry.ts';
const claims=[{id:'one',token:'t',hash:'h',input:JSON.stringify({title:'Dream journal',content:'A familiar corridor.'})}];
const vector=()=>Array.from({length:EMBEDDING_DIMENSIONS},(_,i)=>i===0?1:0);
test('embeddings include titles, use the fixed compatible model and validate all dimensions and batch indices',async()=>{
 const result=await embedNotes(claims,'server-only',async(url,init)=>{
  assert.equal(url,'https://api.openai.com/v1/embeddings');const body=JSON.parse(init.body);assert.equal(body.model,EMBEDDING_MODEL);assert.equal(body.dimensions,1536);assert.deepEqual(body.input,claims.map(c=>c.input));assert.equal(body.encoding_format,'float');
  return Response.json({model:EMBEDDING_MODEL,data:[{index:0,embedding:vector()}],usage:{total_tokens:12}});
 });assert.equal(result.tokens,12);assert.equal(result.vectors[0].hash,'h');assert.equal('input'in result.vectors[0],false);
 for(const malformed of [{index:1,embedding:vector()},{index:0,embedding:[1]},{index:0,embedding:Array(1536).fill(0)}])await assert.rejects(()=>embedNotes(claims,'k',async()=>Response.json({model:EMBEDDING_MODEL,data:[malformed],usage:{total_tokens:12}})),/invalid_embedding/);
 await assert.rejects(()=>embedNotes(claims,'k',async()=>new Response('',{status:429})),/provider/);
 await assert.rejects(()=>embedNotes([{...claims[0],input:'🌻'.repeat(1800)}],'k',()=>assert.fail()),/invalid_embedding/);
 assert.deepEqual(await embedNotes([],'k',()=>assert.fail()),{vectors:[],tokens:0});
});
test('a persistence retry reuses the paid embedding result without another provider request',async()=>{
 let calls=0,writes=0;const paid=await embedNotes(claims,'k',async()=>{calls++;return Response.json({model:EMBEDDING_MODEL,data:[{index:0,embedding:vector()}],usage:{total_tokens:12}})});
 const saved=await retrySemanticWrite(async()=>{writes++;if(writes===1)throw new Error('temporary database failure');return paid.vectors;});assert.equal(calls,1);assert.equal(writes,2);assert.equal(saved[0].hash,'h');
});
