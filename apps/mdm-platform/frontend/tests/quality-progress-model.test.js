import test from 'node:test';
import assert from 'node:assert/strict';
import {qualityProgress} from '../src/qualityProgressModel.js';

test('current field counts distinguish governed records from registered legacy fields without inventing confirmation metrics',()=>{
  for(const [governed,legacy] of [[0,0],[3,7]]) {
    const source={view:'current',overall:{total:governed,governed},legacy:{total:legacy,governance_status:'legacy_unapproved'},complete:true},original=structuredClone(source),value=qualityProgress(source);
    assert.deepEqual(value,{kind:'controlled',total:governed,governed,legacyTotal:legacy});
    assert(!Object.hasOwn(value,'confirmed'));assert(!Object.hasOwn(value,'pct'));assert.deepEqual(source,original);
  }
});

test('legacy identity responses remain a separate historical count and preserve their optional recorded ratio',()=>{
  const source={overall:{total:3,confirmed:2,pct:67},by_domain:[{domain:'历史资产卡片',total:3,confirmed:2,pct:67}]};
  assert.deepEqual(qualityProgress(source),{kind:'legacy-identities',total:3,confirmed:2,pct:67,groups:source.by_domain});
  assert.equal(qualityProgress({overall:{total:0,confirmed:0,pct:0},by_domain:[]}).pct,0);
  assert.equal(qualityProgress({overall:{total:0,confirmed:0},by_domain:[]}).pct,undefined);
});

test('incomplete, wrong-view or malformed responses fail explicitly instead of producing zero or a false completion',()=>{
  const valid={view:'current',overall:{total:2,governed:2},legacy:{total:1,governance_status:'legacy_unapproved'},complete:true};
  for(const data of [{},{...valid,complete:false},{...valid,view:'history'},{...valid,legacy:null},{...valid,overall:{total:2,governed:3}},{overall:{total:0,confirmed:0},by_domain:null},{overall:{total:3,confirmed:2,pct:NaN},by_domain:[]}])assert.throws(()=>qualityProgress(data),/未将其解释为没有记录/);
});
