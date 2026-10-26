import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createDiscoveryRepository } from '../src/lib/discovery-repository.ts';
import { createRelatedRepository } from '../src/lib/related-repository.ts';
const uuid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const request={mode:'topic',topic:'A source title',sessionId:uuid,requestId:other};
function fixture(result,status=200){const requests=[];const api=createClient('https://test.supabase.co','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{requests.push({url:new URL(url),init});return Response.json(result,{status});}}});return {api,requests};}
test('discovery sends a POST with bounded topic/session/request identifiers, no owner or private URL query',async()=>{
 const {api,requests}=fixture({item:null});assert.equal(await createDiscoveryRepository(api).next(request),null);
 assert.equal(requests[0].url.pathname,'/functions/v1/discover-notes');assert.equal(requests[0].url.search,'');assert.deepEqual(JSON.parse(requests[0].init.body),request);
});
test('response validation and network failure leave the saved note path untouched',async()=>{
 for(const response of [{},{item:{note_id:'untrusted'}}])await assert.rejects(createDiscoveryRepository(fixture(response).api).next(request),/unavailable/);
 await assert.rejects(createDiscoveryRepository(fixture({},503).api).next(request),/connection/);
});
test('discovery feedback is scoped to its owner and request and cannot mutate note content',async()=>{
 const {api,requests}=fixture({request_id:other});await createDiscoveryRepository(api).dismiss(uuid,other);
 assert.equal(requests[0].url.pathname,'/rest/v1/note_discovery_history');assert.equal(requests[0].url.searchParams.get('user_id'),'eq.'+uuid);assert.deepEqual(JSON.parse(requests[0].init.body),{dismissed:true});
});
test('capture resurfacing and dismissals reuse the related-note repository rather than another detector',async()=>{
 const {api,requests}=fixture([]),repo=createRelatedRepository(api);
 await repo.read(uuid,undefined,true);assert.equal(requests[0].url.pathname,'/rest/v1/rpc/read_resurfaced_notes');
 await repo.dismiss(uuid,other);assert.deepEqual(JSON.parse(requests[1].init.body),{origin_id:uuid,target_id:other});
});
