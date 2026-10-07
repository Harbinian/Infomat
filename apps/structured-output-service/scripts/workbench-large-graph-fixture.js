// Extend the generated fictional graph only; never copy or rewrite a business process.
const fs = require('node:fs');
const path = require('node:path');
const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath || path.resolve(sourcePath) === path.resolve(outputPath)) throw new Error('Distinct fictional input and output paths are required.');
const fixture = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
if (fixture.process?.process_name !== '虚构测试：判断分支与并行阅读') throw new Error('Only the fictional graph fixture is accepted.');
const node = fixture.behaviors[0];
const edge = fixture.flow_relations.find(item => item.relation_type === 'sequence');
let previous = fixture.behaviors.at(-1).behavior_ref;
for (let index = 0; index < 90; index += 1) {
  const ref = 'fictional_large_' + index;
  fixture.behaviors.push({ ...node, behavior_ref: ref, behavior_name: '虚构长图测试：逐项核对已有记录与条件 ' + index });
  fixture.flow_relations.push({ ...edge, relation_ref: 'fictional_large_route_' + index, from_behavior_ref: previous, to_behavior_ref: ref, condition: '' });
  previous = ref;
}
fixture.process.process_name = '虚构测试：长图全图边界';
fs.writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + '\n');
