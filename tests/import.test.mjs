import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { decodeImport, readImport, runImport, MAX_IMPORT_BYTES } from '../src/lib/import-contract.ts';
import { createImportRepository } from '../src/lib/import-repository.ts';
const bytes = text => new TextEncoder().encode(text);

test('plain text and Markdown preserve exact Unicode, whitespace, line endings, and scripts as text', () => {
  const content = '  # Journal\r\n🌻 Café 日本語\n<script>alert(1)</script>\n\n';
  for (const name of ['Journal.TXT', 'Journal.md', 'a.md']) assert.equal(readImport(name, bytes(content)).content, content);
  assert.equal(decodeImport(new Uint8Array([239,187,191,...bytes(content)])), content);
  assert.equal(readImport('2020-01-01.txt', bytes('Memory')).metadata.created_at, undefined);
});
test('reject unsupported, empty, binary, malformed UTF-8, oversized and overlong notes', () => {
  for (const name of ['notes.pdf', '../notes.md', 'a\u0000.txt']) assert.throws(() => readImport(name, bytes('Text')));
  for (const data of [bytes(' \t\r\n'), bytes('a\u0000b'), Uint8Array.from([0xc0,0xaf]), Uint8Array.from([0xe2,0x82]), Uint8Array.from([0xed,0xa0,0x80]), Uint8Array.from([0xf4,0x90,0x80,0x80]), new Uint8Array(MAX_IMPORT_BYTES+1)]) assert.throws(() => decodeImport(data));
  assert.throws(() => decodeImport(bytes('a'.repeat(100001))), /100,000/);
  assert.equal(Array.from(decodeImport(bytes('🌻'.repeat(50000)))).length, 50000);
});
test('only explicit bounded metadata is extracted; original front matter remains untouched', () => {
  const content = '---\ntitle: "Creative habits"\ncreated_at: 2020-01-02\nsource_type: book\nsource_name: A real supplied title\nsource_url: https://example.com/book\nsource_context: Chapter 2\nauthor: Unknown\n---\n# Original words\n';
  const draft=readImport('old.md',bytes(content));
  assert.equal(draft.content,content); assert.equal(draft.metadata.created_at,'2020-01-02');
  assert.equal(draft.metadata.title,'Creative habits'); assert.equal(draft.metadata.source_type,'book');
  assert.equal(draft.metadata.author,undefined); assert.deepEqual(draft.warnings,[]);
  assert.equal(readImport('a.md',bytes('---\ntitle: First\ntitle: Second\ntitle: Third\n---\nText')).metadata.title,undefined);
});
test('ambiguous, impossible, future dates and unsafe or incomplete source metadata are not promoted', () => {
  for (const date of ['yesterday','01/02/2020','2021-02-29','2099-01-01','2020-01-01T10:00:00']) {
    const draft=readImport('a.md',bytes(`---\ncreated_at: ${date}\n---\nText`));
    assert.equal(draft.metadata.created_at,undefined); assert.ok(draft.warnings.length);
  }
  for (const url of ['javascript:alert(1)','https://user:pass@example.com','https://example.com/a b']) {
    const draft=readImport('a.md',bytes(`---\nsource_type: article\nsource_url: ${url}\n---\nText`)); assert.equal(draft.metadata.source_type,undefined);
  }
  assert.equal(readImport('a.md',bytes('---\nsource_name: Mention only\n---\nText')).metadata.source_name,undefined);
});
test('batch failures are isolated and safe retry only revisits failed files', async () => {
  const drafts=['one','two','three'].map(content=>readImport(`${content}.txt`,bytes(content)));
  const items=drafts.map(draft=>({filename:draft.filename,draft,status:'ready'}));
  items.push({filename:'bad.pdf',status:'failed',message:'Unsupported'});
  let attempts=[]; let progress=[];
  const first=await runImport(items,async d=>{ attempts.push(d.filename); if(d.filename==='two.txt') throw new Error('Offline'); return {status:d.filename==='three.txt'?'skipped':'imported',id:d.filename}; },(state,count)=>progress.push(count));
  assert.deepEqual(first.map(i=>i.status),['imported','failed','skipped','failed']); assert.deepEqual(progress,[1,2,3,4]);
  attempts=[];
  const retry=await runImport(first,async d=>{attempts.push(d.filename); return {status:'skipped',id:'two'};},()=>{});
  assert.deepEqual(attempts,['two.txt']); assert.equal(retry[1].status,'skipped');
});
test('interruption stops before starting another file and does not undo saved files', async () => {
  let stopped=false; let saved=0;
  const draft=readImport('a.md',bytes('Original'));
  const result=await runImport([1,2,3].map(()=>({filename:'a.md',draft,status:'ready'})),async()=>{saved++;stopped=true;return {status:'imported',id:'one'};},()=>{},()=>stopped);
  assert.equal(saved,1); assert.equal(result[1].status,'ready');
});
test('persistence uses a POST RPC without an owner parameter or enrichment request', async () => {
  const calls=[];
  const client=createClient('https://test.supabase.co','public-test',{auth:{persistSession:false},global:{fetch:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init.body),method:init.method});return new Response(JSON.stringify({status:'imported',id:'note-id'}),{headers:{'Content-Type':'application/json'}});}}});
  const draft=readImport('note.txt',bytes('  Exact original\n'));
  assert.equal((await createImportRepository(client).save(draft)).status,'imported');
  assert.equal(calls.length,1); assert.match(calls[0].url,/rpc\/import_text_note$/); assert.equal(calls[0].method,'POST');
  assert.deepEqual(calls[0].body,{file_name:'note.txt',body:'  Exact original\n',metadata:{}});
});
