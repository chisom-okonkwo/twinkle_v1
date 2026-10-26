import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { type DiscoveryCandidate, rankDiscovery, validateCaptureSeen, validateDiscoveryRequest } from '../_shared/discovery-contract.ts';
const cors = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS' };
const reply = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const options = { auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,{...init,signal:init?.signal??AbortSignal.timeout(7000)})} };
const admin = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,options);
Deno.serve(async request=>{
 if(request.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(request.method!=='POST') return reply({error:'Use POST.'},405);
 try {
  const bearer=request.headers.get('Authorization')??'';
  if(!bearer.startsWith('Bearer ')) return reply({error:'Sign in to discover your notes.'},401);
  const auth=await admin.auth.getUser(bearer.slice(7));
  if(auth.error||!auth.data.user)return reply({error:'Sign in again to discover your notes.'},401);
  const reader=request.body?.getReader();let raw='',length=0; const decoder=new TextDecoder();
  if(reader)while(true){const chunk=await reader.read();if(chunk.done)break;length+=chunk.value.length;if(length>2048){await reader.cancel();return reply({error:'Request too large.'},413);}raw+=decoder.decode(chunk.value,{stream:true});}
  raw+=decoder.decode();
  const value=JSON.parse(raw),userId=auth.data.user.id;
  if(value?.action==='capture_seen'){
   const seen=validateCaptureSeen(value);
   const saved=await admin.rpc('record_capture_rediscovery',{caller_id:userId,origin_id:seen.originId,target_ids:seen.noteIds});
   if(saved.error)throw new Error('unavailable');return reply({ok:true});
  }
  const input=validateDiscoveryRequest(value);
  const parameters={caller_id:userId,discovery_session:input.sessionId,discovery_request:input.requestId,discovery_mode:input.mode};
  async function reserve(candidates:unknown[]) {
   const r=await admin.rpc('reserve_discovery',{...parameters,candidates});
   if(r.error)throw new Error('unavailable');return r.data;
  }
  // Recover a lost response idempotently before changing selection or doing more retrieval.
  const replay=await reserve([]);if(replay)return reply({item:replay});
  if(input.mode==='surprise'){
   for(let page_offset=0;page_offset<=400;page_offset+=100){
    const r=await admin.rpc('discovery_candidates',{caller_id:userId,discovery_session:input.sessionId,page_offset});if(r.error)throw new Error('unavailable');
    const batch=(r.data??[]) as DiscoveryCandidate[],ranked=rankDiscovery(batch,input.sessionId);
    const item=await reserve(ranked.map(({note})=>({id:note.id,updated_at:note.updated_at,source_hash:note.context.source_hash,context_revision:note.context.revision,user_version:note.context.user_version})));
    if(item)return reply({item});if(batch.length<100)break;
   }
   return reply({item:null});
  }
  // Reuse FR-13 as the real authenticated user: SECURITY INVOKER + RLS, no admin search bypass.
  const scoped=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{...options,global:{...options.global,headers:{Authorization:bearer}}});
  for(let offset=0;offset<124;offset+=31){
   const search=await scoped.rpc('search_notes',{search_text:input.topic,page_limit:31,page_offset:offset});if(search.error)throw new Error('unavailable');
   const matches=search.data??[];
   const item=await reserve(matches.map((n:{id:string;updated_at:string})=>({id:n.id,updated_at:n.updated_at})));
   if(item)return reply({item});
   if(matches.length<31)break;
  }
  return reply({item:null});
 }catch{return reply({error:'Couldn’t discover a thought. Your notes are safe; please try again.'},400);}
});
