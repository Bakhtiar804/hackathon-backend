import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quickAnswer} from '../src/services/ai-quick-answer.js';
const units=[{kind:'department',name:'Sales',active:true},{kind:'department',name:'Old',active:false},{kind:'designation',name:'Manager',active:true}];
const p={graceMinutes:15,officeStart:'09:00'};
test('quick answers use saved active department records, never designations or standard catalog',()=>{
 assert.match(quickAnswer({role:'Admin'},'hamare departs kitne ha',p,units).answer,/1 active departments/);
 assert.match(quickAnswer({role:'Admin'},'Hamare departments kitne hain?',p,units).answer,/1 active departments.*Sales/);
 assert.match(quickAnswer({role:'HR'},'How many departments do we have?',p,[]).answer,/0 active/);
 assert.equal(quickAnswer({role:'Employee'},'How many departments do we have?',p,units),null);
});
test('policy FAQ is grounded and compound or broader questions use ordinary authorized AI flow',()=>{
 assert.match(quickAnswer({role:'Employee'},'What is the late grace rule?',p,[]).answer,/15 minutes.*09:00/);
 assert.equal(quickAnswer({role:'Admin'},'How many departments do we have? Show salary too',p,units),null);
 assert.equal(quickAnswer({role:'Admin'},'What is attendance rate?',p,units),null);
});
