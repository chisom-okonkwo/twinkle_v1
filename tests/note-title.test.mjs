import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNoteTitle, notePresentation } from '../src/lib/note-title.ts';

test('optional titles are normalized, Unicode-aware and bounded without changing body text', () => {
  assert.equal(normalizeNoteTitle('  A heading\nfrom Keep\t '), 'A heading from Keep');
  assert.equal(normalizeNoteTitle('  '), '');
  assert.equal(normalizeNoteTitle('🌻'.repeat(300)), '🌻'.repeat(300));
  assert.throws(() => normalizeNoteTitle('a'.repeat(301)), /300/);
  assert.throws(() => normalizeNoteTitle('Title\x01with control'), /300/);
});
test('explicit titles show the whole body in previews; clearing one restores the first-line fallback', () => {
  const base = {content:'First line belongs to the body.\nSecond line.',capture_method:'text',import_metadata:{title:'Original immutable Keep title'}};
  assert.deepEqual(notePresentation({...base,title:'Edited title'}), {title:'Edited title',preview:base.content});
  assert.deepEqual(notePresentation({...base,title:''}), {title:'First line belongs to the body.',preview:'Second line.'});
  assert.equal(notePresentation({...base,content:'',title:'My photo',capture_method:'image'}).title,'My photo');
  assert.equal(notePresentation({...base,content:'',title:'',capture_method:'audio'}).title,'Audio note');
});
