import assert from 'node:assert/strict';
import test from 'node:test';
import {themeEmptyState,themePollDelay} from '../src/lib/theme-presentation.ts';
const state=(changes={})=>({status:'ready',total:8,indexed:8,checked:8,scheduled:false,themes:[],date_coverage:{in_period:8,outside_period:8,unknown_date:10},all_time_group_count:3,...changes});
test('recent empty view explains original dates and offers existing all-time themes without inventing groups',()=>{
 const view=themeEmptyState(state(),'recent');
 assert.match(view.message,/8 notes fall/);assert.match(view.message,/at least two/);assert.match(view.message,/10 notes have no reliable original date/);assert.match(view.message,/not the import date/);assert.equal(view.showAllTime,true);
 assert.equal(themeEmptyState(state({all_time_group_count:0}),'recent').showAllTime,false);
});
test('empty, one-note, unknown-date and failed/unprocessed collections have distinct truthful messages',()=>{
 assert.match(themeEmptyState(state({total:0,date_coverage:{in_period:0,outside_period:2,unknown_date:1}}),'recent').message,/No available notes/);
 assert.match(themeEmptyState(state({total:1,date_coverage:{in_period:1,outside_period:0,unknown_date:0}}),'recent').message,/1 note falls/);
 for(const status of['pending','paused','failed']){
 const view=themeEmptyState(state({status,scheduled:true}),'recent');assert.equal(view.title,'Discovery is not finished');assert.equal(view.showAllTime,false);assert.doesNotMatch(view.message,/No shared group/);
 }
 assert.match(themeEmptyState(state({status:'pending'}),'recent').message,/Choose Continue/);
});
test('visible server work is observed beyond the old timeout; reads back off, finish, or stop at the bound',()=>{
 assert.equal(themePollDelay(state({status:'processing'}),0),2500);
 assert.equal(themePollDelay(state({status:'pending',scheduled:true}),180000),15000);
 assert.equal(themePollDelay(state({status:'processing'}),9*60000),15000);
 assert.equal(themePollDelay(state({status:'processing'}),10*60000),null);
 assert.equal(themePollDelay(state({status:'pending',scheduled:false}),0),null);
 assert.equal(themePollDelay(state({status:'failed',scheduled:true}),180000),30000);
 assert.equal(themePollDelay(state({status:'paused',scheduled:true}),180000),30000);
 assert.equal(themePollDelay(state(),0),null);
});
