import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createSourcesRepository } from '../src/lib/sources-repository.ts';
import { createRelatedRepository } from '../src/lib/related-repository.ts';
const old={note_id:'note',user_id:'owner',version:3,source_type:'book',name:'Old',url:'',description:''};
function fixture(response){const requests=[];const api=createClient('https://test.supabase.co','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{requests.push({url:new URL(url),init});return Response.json(response);}}});return {api,requests};}
test('source writes use independent optimistic versions and never write original notes or owner',async()=>{
 const {api,requests}=fixture({...old,version:4,name:'New'});
 assert.equal((await createSourcesRepository(api).save('owner',old,{...old,source_type:'book',name:'New',url:'',description:''})).version,4);
 assert.equal(requests[0].url.pathname,'/rest/v1/note_sources');
 assert.equal(requests[0].url.searchParams.get('version'),'eq.3');
 assert.equal(requests[0].url.searchParams.get('user_id'),'eq.owner');
 assert.deepEqual(JSON.parse(requests[0].init.body),{source_type:'book',name:'New',url:'',description:''});
});
test('concurrent source edits preserve the local draft with a useful conflict message',async()=>{
 const {api}=fixture(null);
 await assert.rejects(createSourcesRepository(api).save('owner',old,{source_type:'book',name:'New',url:'',description:''}),/another session/);
});
test('related reads are a bounded invoker RPC without private query words or client owner parameter',async()=>{
 const {api,requests}=fixture([]);
 assert.deepEqual(await createRelatedRepository(api).read('note'),[]);
 assert.equal(requests[0].url.pathname,'/rest/v1/rpc/read_related_notes');
 assert.equal(requests[0].url.search,'');
 assert.deepEqual(JSON.parse(requests[0].init.body),{target_id:'note'});
});
