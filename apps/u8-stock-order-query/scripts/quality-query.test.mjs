import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQualityQuery } from '../query.mjs';

test('quality uniqueness query has a separate strict parameter contract',()=>{
  const defaults=parseQualityQuery(new URLSearchParams());
  assert.equal(defaults.status,'duplicate');assert.equal(defaults.pageSize,20);
  assert.equal(parseQualityQuery(new URLSearchParams({drawing:' DRAW-A ',qualityNumber:"x' %_[~"})).qualityNumber,"x' %_[~");
  for(const query of ['sql=SELECT+1','drawing=A&drawing=B','status=resolved','pageSize=101','page=0','qualityNumber=%00','drawing='+('X'.repeat(121))])assert.throws(()=>parseQualityQuery(new URLSearchParams(query)),query);
});
test('quality details require both exact group keys while retaining empty-number groups',()=>{
  assert.throws(()=>parseQualityQuery(new URLSearchParams('drawing=A'),true));
  assert.throws(()=>parseQualityQuery(new URLSearchParams('drawing=A&qualityNumber=Q&status=all'),true));
  const value=parseQualityQuery(new URLSearchParams('drawing=&qualityNumber='),true);
  assert.equal(value.drawing,'');assert.equal(value.qualityNumber,'');assert.equal(value.pageSize,50);
});
