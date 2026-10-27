import assert from 'node:assert/strict';import test from'node:test';import{coherentCandidateSets}from'../supabase/functions/_shared/semantic-candidates.ts';
test('strong connected chains do not become a single incoherent thematic group',()=>{
 const groups=coherentCandidateSets(['a','b','c'],[{a:'a',b:'b',similarity:.8},{a:'b',b:'c',similarity:.8},{a:'a',b:'c',similarity:.1}]);
 assert.ok(groups.length);assert.ok(groups.every(g=>g.length===2));assert.ok(groups.some(g=>g.includes('a')&&g.includes('b')));assert.ok(groups.some(g=>g.includes('b')&&g.includes('c')));
});
test('coherent neighbourhoods overlap, sparse/unrelated notes remain ungrouped, and repeated sets dedupe',()=>{
 const groups=coherentCandidateSets(['a','b','c','d','unrelated'],[{a:'a',b:'b',similarity:.8},{a:'a',b:'c',similarity:.7},{a:'b',b:'c',similarity:.75},{a:'c',b:'d',similarity:.7}]);
 assert.ok(groups.some(g=>g.length===3));assert.ok(groups.some(g=>g.includes('c')&&g.includes('d')));assert.ok(groups.every(g=>!g.includes('unrelated')));
 assert.equal(new Set(groups.map(g=>[...g].sort().join(':'))).size,groups.length);
 assert.deepEqual(coherentCandidateSets(['a'],[]),[]);assert.deepEqual(coherentCandidateSets(['a','b'],[{a:'a',b:'b',similarity:.1}]),[]);
});
