import assert from 'node:assert/strict';import test from 'node:test';import{readFile}from'node:fs/promises';
const f=JSON.parse(await readFile(new URL('./fixtures/semantic-themes-evaluation.json',import.meta.url),'utf8'));
test('semantic evaluation rubric has distinct notes, explicit positives and negatives, broad/narrow groups and unknown dates',()=>{
 const keys=new Set(f.notes.map(n=>n.key));assert.equal(keys.size,f.notes.length);
 for(const g of f.expectedGroups){assert.ok(g.members.length>=3);assert.ok(g.minimumRecall>=2);for(const k of [...g.members,...g.forbidden])assert.ok(keys.has(k));assert.ok(!g.members.some(k=>g.forbidden.includes(k)));}
 for(const pair of [...f.positiveNeighbours,...f.negativeNeighbours]){assert.equal(pair.length,2);assert.notEqual(pair[0],pair[1]);assert.ok(pair.every(k=>keys.has(k)));}
 assert.ok(f.notes.some(n=>n.body.length<40&&n.title));assert.ok(f.notes.some(n=>n.imported&&!n.date));assert.ok(f.notes.some(n=>n.date&&Date.parse(n.date)<Date.parse(f.week.start)));
 assert.ok(f.expectedGroups[1].members.every(k=>f.expectedGroups[0].members.includes(k)));
 assert.ok(f.expectedGroups[2].members.some(k=>f.expectedGroups[3].members.includes(k)));
});

test('rubric cannot mistake the narrower dream subset for the broader subject',()=>{
 const [broad,narrow]=f.expectedGroups;assert.ok(broad.minimumRecall>narrow.members.length);
 for(const g of f.expectedGroups)assert.deepEqual([...g.members,...g.forbidden].sort(),f.notes.map(n=>n.key).sort());
});
