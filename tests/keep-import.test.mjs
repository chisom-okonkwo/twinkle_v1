import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { readImport, reviewImportFiles, runImport, MAX_IMPORT_BYTES } from '../src/lib/import-contract.ts';
import { createImportRepository } from '../src/lib/import-repository.ts';
import { importProvenance } from '../src/lib/import-provenance.ts';
const bytes = text => new TextEncoder().encode(text);
const fixture = name => readFile(new URL(`./fixtures/keep/${name}`, import.meta.url));
const note = (fields = {}) => ({title:'Synthetic note',textContent:'Original words',isArchived:false,isPinned:false,isTrashed:false,createdTimestampUsec:1577880000123456,userEditedTimestampUsec:1577966400654000,...fields});
const readJson = fields => readImport('Sample.json', bytes(JSON.stringify(note(fields))));
const html = content => `<div class="note DEFAULT"><div class="title">A &amp; B</div><div class="content">${content}</div></div>`;

test('sample-shaped JSON preserves literal words and title and converts original microsecond dates without using rich-text alternatives', async () => {
  const input=await fixture('Reflection.json'); const original=JSON.parse(input);
  const draft=readImport('Reflection.json', input);
  assert.equal(draft.content,original.textContent); assert.equal(draft.metadata.title,original.title);
  assert.equal(draft.metadata.created_at,'2020-01-01T12:00:00.123Z');
  assert.equal(draft.metadata.original_updated_at,'2020-01-02T12:00:00.654Z');
  assert.equal(draft.metadata.provider,'google_keep'); assert.deepEqual(draft.warnings,[]);
  assert.equal(readJson({textContent:'---\nsource_type: book\nsource_name: Unconfirmed\n---\nText'}).metadata.source_type,undefined);
});
test('HTML-only exports decode Unicode/entities, preserve line breaks, and do not infer dates from filenames', async () => {
  const draft=readImport('2030-01-01.HTML',await fixture('Reflection.html'));
  assert.equal(draft.content,JSON.parse(await fixture('Reflection.json')).textContent);
  assert.equal(draft.metadata.title,'Creative work & rest');
  assert.equal(draft.metadata.created_at,undefined); assert.equal(draft.metadata.original_updated_at,undefined);
  assert.ok(draft.warnings.some(w=>/creation date/.test(w)));
  assert.equal(readImport('a.html',bytes(html('A&#160;B &#x1F33B; &eacute;'))).content,'A\u00a0B 🌻 é');
  assert.equal(readImport('a.html',bytes(html('<p>First</p><p>Second<br>Third</p>'))).content,'First\nSecond\nThird');
});
test('both formats preserve checklist order and completion and keep multiline items readable', async () => {
  for(const extension of ['json','html']){
    const draft=readImport(`Checklist.${extension}`,await fixture(`Checklist.${extension}`));
    assert.equal(draft.content,'- [ ] Draft & review\n- [x] Send the proposal\n- [ ] Read the chapter');
    assert.equal(draft.metadata.title,'Weekend list');
  }
  assert.equal(readJson({textContent:'',listContent:[{text:'Line one\nLine two',isChecked:true}]}).content,'- [x] Line one\n  Line two');
  assert.equal(readImport('a.html',bytes(html('<ul class="list"><li class="listitem checked">\n  <span class="bullet">☑</span>\n  <span class="text">First\nSecond</span>\n</li></ul>'))).content,'- [x] First\n  Second');
  assert.throws(()=>readJson({listContent:[{text:'State is unknown',isChecked:'false'}]}),/completion state/);
});
test('attachment omission is explicit for both formats; attachment-only notes and trashed JSON are rejected', async () => {
  for(const extension of ['json','html']){
    const draft=readImport(`Attachments.${extension}`,await fixture(`Attachments.${extension}`));
    assert.equal(draft.content,'The words beside a photo and recording.');
    assert.ok(draft.warnings.some(w=>/Attachments are not imported/.test(w)));
  }
  assert.throws(()=>readJson({textContent:'',attachments:[{filePath:'photo.jpg'}]}),/no text.*Attachments/);
  assert.throws(()=>readJson({isTrashed:true}),/trash/);
  assert.ok(readJson({isArchived:true}).warnings.some(w=>/Archived/));
});
test('HTML is inert and excludes code, styles, embedded documents, hidden text, and annotation chrome', () => {
  globalThis.__keepCodeExecuted=false;
  const content=html('Safe<script>globalThis.__keepCodeExecuted=true</script><style>@import "https://invalid.test/style.css"</style><iframe src="https://invalid.test">Wrong</iframe><span hidden>Secret</span><span style="display:none">Hidden</span><b onclick="alert(1)"> words</b><img src="https://invalid.test/private.jpg" onerror="alert(2)">');
  const draft=readImport('safe.html',bytes(content.replace('</div></div>','</div><div class="chips">Annotation chrome</div></div>')));
  assert.equal(draft.content,'Safe words'); assert.equal(globalThis.__keepCodeExecuted,false);
  assert.ok(draft.warnings.some(w=>/Attachments/.test(w)));
  delete globalThis.__keepCodeExecuted;
});
test('unsupported JSON/HTML, corrupt exports, invalid decoded text, excessive markup and oversize input fail per file', () => {
  for(const input of ['{}','[]','null','{"title":"Only arbitrary JSON"}','{"textContent":','{"title":"A","textContent":4,"isArchived":false}']) assert.throws(()=>readImport('a.json',bytes(input)));
  for(const input of ['<p>Ordinary website</p>',html('One')+html('Two'),html(''),html('<div>'.repeat(70)+'Text'+'</div>'.repeat(70))]) assert.throws(()=>readImport('a.html',bytes(input)));
  assert.throws(()=>readJson({textContent:'a\u0000b'}),/invalid text/);
  assert.throws(()=>readJson({textContent:'\ud800'}),/invalid text/);
  assert.throws(()=>readJson({title:'A'.repeat(301)}),/title/);
  assert.throws(()=>readImport('a.json',new Uint8Array(MAX_IMPORT_BYTES+1)),/256 KB/);
  assert.throws(()=>readJson({textContent:'A'.repeat(100001)}),/100,000/);
  assert.throws(()=>readImport('../a.html',bytes(html('Text'))),/name/);
  assert.throws(()=>readImport('a.zip',bytes('Zip')),/Choose/);
});
test('missing, unsafe, future or inconsistent source dates are omitted with a visible explanation', () => {
  for(const value of [undefined,'yesterday',0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Date.now()*1000+86_400_000_000]){
    const draft=readJson({createdTimestampUsec:value});
    assert.equal(draft.metadata.created_at,undefined); assert.ok(draft.warnings.some(w=>/creation date/.test(w)));
  }
  const draft=readJson({userEditedTimestampUsec:1577800000000000});
  assert.equal(draft.metadata.original_updated_at,undefined);assert.ok(draft.warnings.some(w=>/modification date/.test(w)));
});
test('20 selected paired files become 10 notes, preferring JSON regardless of picker order and avoiding HTML reads', async () => {
  const assets=Array.from({length:10},(_,i)=>({name:`Thought ${i}.html`})).concat(Array.from({length:10},(_,i)=>({name:`Thought ${i}.json`}))) ;
  const reads=[]; const updates=[];
  const reviewed=await reviewImportFiles(assets,async asset=>{reads.push(asset.name);return readImport(asset.name,bytes(JSON.stringify(note({textContent:asset.name}))));},(items,count)=>updates.push(count));
  assert.deepEqual(reviewed.map(item=>item.filename),assets.map(asset=>asset.name));
  assert.equal(reviewed.filter(item=>item.status==='ready').length,10);
  assert.equal(reviewed.filter(item=>item.status==='skipped').length,10);
  assert.equal(reads.length,10);assert.ok(reads.every(name=>name.endsWith('.json')));
  assert.ok(reviewed.slice(0,10).every(item=>!item.draft && /using JSON once/.test(item.message)));
  let saved=0;
  await runImport(reviewed,async()=>({status:'imported',id:String(++saved)}),()=>{});
  assert.equal(saved,10);assert.equal(updates.at(-1),20);
});
test('15 and 20 independent notes import sequentially, with isolated failures, fallback HTML and bounded batch input', async () => {
  for(const count of [15,20]){
    const assets=Array.from({length:count},(_,i)=>({name:`Thought ${i}.json`}));
    const reviewed=await reviewImportFiles(assets,async asset=>readImport(asset.name,bytes(JSON.stringify(note({textContent:asset.name})))),()=>{});
    let saved=0;
    const result=await runImport(reviewed,async()=>({status:'imported',id:String(++saved)}),()=>{});
    assert.equal(result.filter(item=>item.status==='imported').length,count);
  }
  const fallback=await reviewImportFiles([{name:'a.html'},{name:'a.json'},{name:'other.txt'}],async asset=>readImport(asset.name,bytes(asset.name==='a.json'?'broken':asset.name.endsWith('.html')?html('Keep words'):'Ordinary text')),()=>{});
  assert.equal(fallback[0].status,'ready');assert.equal(fallback[1].status,'failed');assert.equal(fallback[2].status,'ready');
  assert.ok(fallback[0].draft.warnings.some(w=>/paired JSON could not be read/.test(w)));
  const bounded=await reviewImportFiles(Array.from({length:10},(_,i)=>({name:`${i}.txt`})),async asset=>({...readImport(asset.name,bytes('Text')),size:MAX_IMPORT_BYTES}),()=>{});
  assert.equal(bounded.filter(item=>item.status==='ready').length,8);
  await assert.rejects(()=>reviewImportFiles(Array.from({length:21},()=>({name:'a.txt'})),async()=>assert.fail('must not read'),()=>{}),/20 files/);
});
test('Keep persistence retains filename/dates through the existing RPC with no owner or AI request', async () => {
  const calls=[];
  const client=createClient('https://test.supabase.co','public-test',{auth:{persistSession:false},global:{fetch:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return new Response(JSON.stringify({status:'imported',id:'note-id'}),{headers:{'Content-Type':'application/json'}});}}});
  const draft=readJson();
  await createImportRepository(client).save(draft);
  assert.equal(calls.length,1);assert.match(calls[0].url,/rpc\/import_text_note$/);
  assert.deepEqual(calls[0].body,{file_name:'Sample.json',body:draft.content,metadata:draft.metadata});
  const provenance=importProvenance({filename:'Sample.json',imported_at:'2026-10-26T00:00:00Z',original_created_at:draft.metadata.created_at,original_updated_at:draft.metadata.original_updated_at});
  assert.equal(provenance.originalUpdatedAt,draft.metadata.original_updated_at);
});
