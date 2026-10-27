// Synthetic retained fixture only; never accepts a real-user collection.
import assert from'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{createClient}from'@supabase/supabase-js';
const users=JSON.parse(await readFile(process.env.TWINKLE_TEST_FIXTURES,'utf8'));assert.ok(users.every(u=>/^twinkle-themes-[0-9a-f-]+@example\.invalid$/.test(u.email)));
const api=createClient(process.env.EXPO_PUBLIC_SUPABASE_URL,process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});assert.ifError((await api.auth.signInWithPassword(users[0])).error);
const output=[];
try{for(const period of['recent','custom']){const started=performance.now();for(let i=0;i<3;i++){
const r=await api.functions.invoke('semantic-notes',{body:{period,...(period==='custom'?{range_start:'2026-10-19T00:00:00Z',range_end:'2026-10-26T00:00:00Z',timezone:'UTC'}:{})},timeout:20000});assert.ifError(r.error);
let state;for(let wait=0;wait<120;wait++){const p=await api.rpc('semantic_index_snapshot');assert.ifError(p.error);state=p.data;if(state.status==='failed')throw new Error(state.error_code);if(state.status!=='processing')break;await new Promise(resolve=>setTimeout(resolve,1000));}assert.notEqual(state.status,'processing');}
const s=await api.rpc('note_theme_snapshot',{period:'recent'});assert.ifError(s.error);output.push({period,elapsedMs:Math.round(performance.now()-started),groups:s.data.themes.length,indexed:s.data.indexed,checked:s.data.checked,pending:s.data.pending});}
await writeFile(process.env.TWINKLE_EVAL_REPORT,JSON.stringify(output,null,2));console.log(JSON.stringify(output));}finally{await api.auth.signOut({scope:'global'});}
