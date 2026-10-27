import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffReturnLabel,handoffTargetWithReturn,handoffWorkspaceHref,parseHandoffSelection,safeHandoffReturn,sameHandoffSelection} from '../src/handoffNavigation.js';

const handoff = {kind:'handoff',id:'d48c916d-a131-4e7e-9b03-ad34adca6b68'};
test('3000 entry preserves exact large identities, fixed revision and known ledger return context', () => {
  const back='/app/data-map?context=9007199254740993&view=history&version=280&identityField=901';
  const href=handoffWorkspaceHref({...handoff,revision:2},back), query=new URL(href,'https://local.invalid').searchParams;
  assert.deepEqual(parseHandoffSelection(query),{...handoff,revision:2});
  assert.equal(query.get('return_to'),back);
  assert.equal(safeHandoffReturn(back),back);
  assert.equal(handoffReturnLabel(back),'返回数据地图台账');
  assert.equal(handoffWorkspaceHref({kind:'package',id:'9007199254740993'}),'/app/data-map-handoffs?package=9007199254740993');
});
test('return contexts never navigate outside exact supported pages or carry unrecognized parameters', () => {
  for(const value of ['https://other.invalid/app/todos','//other.invalid/app/todos','/app/x/../todos','/app/todos#x','/app/todos?return_to=https://other.invalid','/app/todos?status=pending&status=done','/app/todos?status=other','/app/todos\\x','/app/data-governance?package=2&factRequest=3','/app/data-map?context=2&version=3','/app/data-map?context=2&view=history&version=','/app/todos%0a']) assert.equal(safeHandoffReturn(value),null,value);
  assert.equal(new URL(handoffWorkspaceHref(handoff,'https://other.invalid'),'https://local.invalid').searchParams.has('return_to'),false);
  assert.equal(safeHandoffReturn('/app/todos?status=pending&type=conflict_resolution'),'/app/todos?status=pending&type=conflict_resolution');
});
test('ambiguous resources and malformed revisions cannot select or confer action on another item', () => {
  for(const value of ['package=1&fact='+handoff.id,'package=1&package=2','handoff='+handoff.id+'&revision=9007199254740993','conflict='+handoff.id+'&revision=2','package=0','handoff=1','handoff='+handoff.id+'&write=1']) assert.equal(parseHandoffSelection(value),null,value);
  assert.equal(sameHandoffSelection(handoff,{...handoff,revision:1}),false);
  assert.equal(sameHandoffSelection(handoff,{...handoff}),true);
  assert.equal(handoffTargetWithReturn(handoffWorkspaceHref(handoff,'/app/workbench'),'/app/todos?status=pending'),handoffWorkspaceHref(handoff,'/app/todos?status=pending'));
  assert.equal(handoffTargetWithReturn('https://other.invalid/app/data-map-handoffs?handoff='+handoff.id,'/app/todos'),null);
});
