/**
 * Normalize department Sankey H5 pages for the current process-evidence mapping rules.
 *
 * Scope:
 * - docs/norms/*部门能力流程系统桑基图.html
 * - visual labels only; this script does not change department mapping conclusions.
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const NORMS = resolve(import.meta.dirname || '.', '..', 'docs', 'norms');

const helperBlock = `function a1ShortCode(a1) {
        var id = Array.isArray(a1) ? a1[0] : a1;
        var m = String(id || "").match(/A\\d+$/);
        return m ? m[0] : String(id || "");
      }

      function a1JoinedText(a1) {
        return Array.isArray(a1) ? a1.join(" ") : String(a1 || "");
      }

      function isInferenceEvidence(a1) {
        return /上下文推断|分析拆分/.test(String((Array.isArray(a1) ? a1[8] : a1) || ""));
      }

      function hasEvidenceGap(a1) {
        return /待补|未见|缺少|证据不足/.test(a1JoinedText(a1));
      }

      function a1NodeColor(a1) {
        if (roleWarning(a1) || hasEvidenceGap(a1)) return "#dc2626";
        if (isInferenceEvidence(a1)) return "#f59e0b";
        return "#64748b";
      }

      function processName(rowOrProc) {
        if (rowOrProc && typeof rowOrProc === "object" && !Array.isArray(rowOrProc)) {
          return rowOrProc.process || rowOrProc.proc || rowOrProc.l3 || "";
        }
        var raw = String(rowOrProc || "");
        if (typeof l3NameMap !== "undefined" && l3NameMap && l3NameMap[raw]) return l3NameMap[raw];
        return raw;
      }

      function l3CodeFromText(value) {
        var m = String(value || "").match(/L3[-_ ]?(\\d+)/i);
        return m ? "L3-" + String(m[1]).padStart(2, "0") : "";
      }

      function processCode(rowOrProc) {
        var raw = rowOrProc && typeof rowOrProc === "object" && !Array.isArray(rowOrProc)
          ? String(rowOrProc.code || rowOrProc.id || rowOrProc.process || rowOrProc.proc || "")
          : String(rowOrProc || "");
        var name = processName(rowOrProc);
        var directCode = l3CodeFromText(raw) || l3CodeFromText(name);
        if (directCode) return directCode;

        if (typeof a1Rows !== "undefined") {
          for (var i = 0; i < a1Rows.length; i++) {
            if (String(a1Rows[i][14] || "") === name || String(a1Rows[i][11] || "") === name) {
              var fromA1 = l3CodeFromText(a1Rows[i][0]);
              if (fromA1) return fromA1;
            }
          }
        }

        var idx = typeof l3Rows !== "undefined"
          ? l3Rows.findIndex(function(row) { return processName(row) === name; })
          : -1;
        return idx >= 0 ? "L3-" + String(idx + 1).padStart(2, "0") : "L3";
      }

      function processDisplayLabel(rowOrProc) {
        var name = processName(rowOrProc);
        return processCode(rowOrProc) + " " + name;
      }

      function isProcessNode(name) {
        var text = String(name || "");
        if (typeof l3Rows !== "undefined" && l3Rows.some(function(row) {
          return processName(row) === text;
        })) return true;
        if (typeof a1Rows !== "undefined" && a1Rows.some(function(row) {
          if (String(row[14] || "") === text || String(row[11] || "") === text) return true;
          return typeof l3NameMap !== "undefined" && l3NameMap && String(l3NameMap[row[11]] || "") === text;
        })) return true;
        return false;
      }

      function modeDisplayLabel(name) {
        return name === "全域总览" ? "全域总览（层级范围 L1-L3）" : name + "（层级范围 L1-A1）";
      }

      function evidenceLegendHtml() {
        return '<span class="legend"><i style="background:#64748b"></i>原文明确</span>' +
          '<span class="legend"><i style="background:#f59e0b"></i>上下文推断/分析拆分</span>' +
          '<span class="legend"><i style="background:#dc2626"></i>待补证据/需确认</span>';
      }`;

function insertHelper(text) {
  if (text.includes('function a1ShortCode(a1)')) return text;
  return text.replace(/(\s*)function a1DisplayLabel\(a1\)/, `$1${helperBlock}\n\n$1function a1DisplayLabel(a1)`);
}

function normalizeText(text) {
  let out = text;
  const detailOld = '业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）';
  const detailNew = '能力域（L1-A1）：业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）';
  const detailToken = '__INFOMAT_DETAIL_CHAIN__';
  const fullChain = '部门（D1）→ 能力域（L1-L3）→ 业务能力（L2）→ 应用系统（S1）[全域]；能力域（L1-A1）：业务能力（L2）→ 业务流程（L3）→ 业务行为（A1）→ 应用系统（S1）[域详情]';

  out = insertHelper(out);

  out = out.replace(
    /function processCode\(rowOrProc\) \{\s*var raw = rowOrProc && typeof rowOrProc === "object" && !Array\.isArray\(rowOrProc\)\s*\? String\(rowOrProc\.code \|\| rowOrProc\.id \|\| rowOrProc\.process \|\| rowOrProc\.proc \|\| ""\)\s*: String\(rowOrProc \|\| ""\);\s*var name = processName\(rowOrProc\);\s*var m = raw\.match\(\/L3\[-_ \]\?\(\\d\+\)\/i\) \|\| String\(name \|\| ""\)\.match\(\/L3\[-_ \]\?\(\\d\+\)\/i\);\s*if \(m\) return "L3-" \+ String\(m\[1\]\)\.padStart\(2, "0"\);\s*var rows = typeof filteredL3 === "function" \? filteredL3\(\) : \(typeof l3Rows !== "undefined" \? l3Rows : \[\]\);\s*var idx = rows\.findIndex\(function\(row\) \{ return processName\(row\) === name; \}\);\s*if \(idx < 0 && typeof l3Rows !== "undefined"\) \{\s*idx = l3Rows\.findIndex\(function\(row\) \{ return processName\(row\) === name; \}\);\s*\}\s*return idx >= 0 \? "L3-" \+ String\(idx \+ 1\)\.padStart\(2, "0"\) : "L3";\s*\}/g,
    'function l3CodeFromText(value) {\n        var m = String(value || "").match(/L3[-_ ]?(\\d+)/i);\n        return m ? "L3-" + String(m[1]).padStart(2, "0") : "";\n      }\n\n      function processCode(rowOrProc) {\n        var raw = rowOrProc && typeof rowOrProc === "object" && !Array.isArray(rowOrProc)\n          ? String(rowOrProc.code || rowOrProc.id || rowOrProc.process || rowOrProc.proc || "")\n          : String(rowOrProc || "");\n        var name = processName(rowOrProc);\n        var directCode = l3CodeFromText(raw) || l3CodeFromText(name);\n        if (directCode) return directCode;\n\n        if (typeof a1Rows !== "undefined") {\n          for (var i = 0; i < a1Rows.length; i++) {\n            if (String(a1Rows[i][14] || "") === name || String(a1Rows[i][11] || "") === name) {\n              var fromA1 = l3CodeFromText(a1Rows[i][0]);\n              if (fromA1) return fromA1;\n            }\n          }\n        }\n\n        var idx = typeof l3Rows !== "undefined"\n          ? l3Rows.findIndex(function(row) { return processName(row) === name; })\n          : -1;\n        return idx >= 0 ? "L3-" + String(idx + 1).padStart(2, "0") : "L3";\n      }',
  );

  out = out.replace(/能力域（L1-A1）：能力域（L1-A1）：/g, '能力域（L1-A1）：');
  out = out.replaceAll(detailNew, detailToken);
  out = out.replaceAll(detailOld, detailToken);
  out = out.replaceAll(`部门（D1）→ 能力域（L1）→ ${detailToken}`, fullChain);
  out = out.replaceAll(detailToken, detailNew);
  out = out.replace(
    /部门（D1）→ 能力域（L1）→ 业务能力（L2）→ 应用系统（S1）/g,
    '部门（D1）→ 能力域（L1-L3）→ 业务能力（L2）→ 应用系统（S1）',
  );
  out = out.replace(/能力域（L1）规模/g, '能力域（L1-A1）规模');
  out = out.replace(/切换到具体能力域（L1）/g, '切换到具体能力域（L1-A1）');
  out = out.replace('<span class="mode-label">视图</span>', '<span class="mode-label">视图（层级范围 L1-L3 / L1-A1）</span>');
  out = out.replace(/视图（能力域 L1-L3 \/ L1-A1）/g, '视图（层级范围 L1-L3 / L1-A1）');
  out = out.replace(/业务行为（A1）节点显示行为名称和执行角色/g, '业务行为（A1）节点显示A1序号、行为名称和执行角色');
  out = out.replace(/<i style="background:#0891b2"><\/i>能力域（L1）/g, '<i style="background:#0891b2"></i>能力域（L1-L3）');

  out = out.replace(/\s*\.evidence-tag\.gap\s*\{[^}]*\}/g, '');
  if (!out.includes('.evidence-tag')) {
    out = out.replace(
      /(\.soft-warn-tag \{[^}]*\})/,
      '$1\n      .evidence-tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap; }\n      .evidence-tag.explicit { background: #dcfce7; color: #166534; }\n      .evidence-tag.inferred { background: #fef3c7; color: #92400e; }',
    );
  }
  out = out.replace(
    /(\.evidence-tag\.inferred\s*\{[^}]*\})/,
    '$1\n      .evidence-tag.gap { background: #fee2e2; color: #991b1b; border: 1px solid #dc2626; }',
  );

  out = out.replace(
    /function evidenceClass\(type\) \{\s*return \/\^原文明确-\(正文\|流程图\|表单\)\$\/\.test\(String\(type \|\| ""\)\) \? "explicit" : "inferred";\s*\}/g,
    'function evidenceClass(type) {\n        var text = String(type || "");\n        if (/待补|未见|缺少|证据不足/.test(text)) return "gap";\n        return /^原文明确-(正文|流程图|表单)$/.test(text) ? "explicit" : "inferred";\n      }',
  );
  out = out.replace(
    /function evidenceClass\(evi\)\{return evi==="上下文推断"\|\|evi==="分析拆分"\?"inferred":"explicit";\}/g,
    'function evidenceClass(evi){var text=String(evi||"");if(/待补|未见|缺少|证据不足/.test(text))return"gap";return evi==="上下文推断"||evi==="分析拆分"?"inferred":"explicit";}',
  );

  out = out.replace(
    /return shortText\(a1\[1\], 18\) \+ "\\n" \+ shortText\(role, 18\);/g,
    'return a1ShortCode(a1) + " " + shortText(a1[1], 16) + "\\n" + shortText(role, 18);',
  );
  out = out.replace(
    /return shortText\(a1\[1\],18\)\+"\\n"\+shortText\(role,18\);/g,
    'return a1ShortCode(a1)+" "+shortText(a1[1],16)+"\\n"+shortText(role,18);',
  );

  out = out.replace(
    /itemStyle: \{ color: roleWarning\(a1\) \? "#dc2626" : "#64748b" \}/g,
    'itemStyle: { color: a1NodeColor(a1) }',
  );
  out = out.replace(
    /itemStyle: \{ color: isCollectiveRole\(role\) \? "#dc2626" : "#64748b" \}/g,
    'itemStyle: { color: a1NodeColor(a1) }',
  );
  out = out.replace(
    /nodes\.push\(\{name:name,itemStyle:\{color:nodeColor\[type\]\|\|'#64748b'\},_type:type,_meta:\{id:a1id\|\|name\}\}\);/g,
    "var nodeFill=nodeColor[type]||'#64748b';if(type==='A1'){var a1Row=null;for(var ai=0;ai<a1Rows.length;ai++){if(a1Rows[ai][0]===a1id){a1Row=a1Rows[ai];break;}}nodeFill=a1NodeColor(a1Row||[a1id,name]);}nodes.push({name:name,itemStyle:{color:nodeFill},_type:type,_meta:{id:a1id||name}});",
  );

  out = out.replace(
    /bar\.innerHTML = '<span class="mode-label">视图<\/span>';/g,
    'bar.innerHTML = \'<span class="mode-label">视图（层级范围 L1-L3 / L1-A1）</span>\';',
  );
  out = out.replace(/全域总览（L1-L3）/g, '全域总览（层级范围 L1-L3）');
  out = out.replace(/能力域（L1-L3）/g, '能力域（层级范围 L1-L3）');
  out = out.replace(/（L1-A1）/g, '（层级范围 L1-A1）');
  while (out.includes('能力域（层级范围 L1-A1）：能力域（层级范围 L1-A1）：')) {
    out = out.replace(/能力域（层级范围 L1-A1）：能力域（层级范围 L1-A1）：/g, '能力域（层级范围 L1-A1）：');
  }
  out = out.replace(
    /if \(String\(a1Rows\[i\]\[14\] \|\| ""\) === name\) \{/g,
    'if (String(a1Rows[i][14] || "") === name || String(a1Rows[i][11] || "") === name) {',
  );
  out = out.replace(
    /function isProcessNode\(name\) \{\s*return typeof l3Rows !== "undefined" && l3Rows\.some\(function\(row\) \{\s*return processName\(row\) === String\(name \|\| ""\);\s*\}\);\s*\}/g,
    'function isProcessNode(name) {\n        var text = String(name || "");\n        if (typeof l3Rows !== "undefined" && l3Rows.some(function(row) {\n          return processName(row) === text;\n        })) return true;\n        if (typeof a1Rows !== "undefined" && a1Rows.some(function(row) {\n          if (String(row[14] || "") === text || String(row[11] || "") === text) return true;\n          return typeof l3NameMap !== "undefined" && l3NameMap && String(l3NameMap[row[11]] || "") === text;\n        })) return true;\n        return false;\n      }',
  );
  out = out.replace(/btn\.textContent = name;/g, 'btn.textContent = modeDisplayLabel(name);\n          btn.dataset.mode = name;');
  out = out.replace(/b\.textContent === name/g, 'b.dataset.mode === name');

  out = out.replace(
    /all\.textContent='全域总览';all\.onclick=function\(\)\{setMode\('all'\);\};/g,
    "all.textContent=modeDisplayLabel('全域总览');all.dataset.mode='all';all.onclick=function(){setMode('all',this);};",
  );
  out = out.replace(
    /btn\.textContent=domains\[i\];btn\.onclick=\(function\(d\)\{return function\(\)\{setMode\(d\);\};\}\)\(domains\[i\]\);/g,
    "btn.textContent=modeDisplayLabel(domains[i]);btn.dataset.mode=domains[i];btn.onclick=(function(d){return function(){setMode(d,this);};})(domains[i]);",
  );
  out = out.replace(
    /function setMode\(mode\)\{activeMode=mode;var btns=document\.querySelectorAll\('\.mode-btn'\);for\(var i=0;i<btns\.length;i\+\+\)btns\[i\]\.classList\.remove\('active'\);event\.target\.classList\.add\('active'\);renderSankey\(mode\);renderTable\(mode\);\}/g,
    "function setMode(mode,target){activeMode=mode;var btns=document.querySelectorAll('.mode-btn');for(var i=0;i<btns.length;i++)btns[i].classList.remove('active');if(target)target.classList.add('active');renderSankey(mode);renderTable(mode);}",
  );

  out = out.replace(/document\.getElementById\("legendRow"\)\.innerHTML = dLeg \+ sLeg;/g, 'document.getElementById("legendRow").innerHTML = dLeg + sLeg + evidenceLegendHtml();');
  out = out.replace(/document\.getElementById\('legendRow'\)\.innerHTML=('[^;]+');/g, "document.getElementById('legendRow').innerHTML=$1+evidenceLegendHtml();");

  out = out.replace(
    /if \(!isGlobal && a1Rows\.some\(function\(r\) \{ return r\[0\] === name; \}\)\) \{\s*var a1 = a1Rows\.find\(function\(r\) \{ return r\[0\] === name; \}\);\s*return a1DisplayLabel\(a1\);\s*\}\s*return name;/g,
    'if (!isGlobal && a1Rows.some(function(r) { return r[0] === name; })) {\n                  var a1 = a1Rows.find(function(r) { return r[0] === name; });\n                  return a1DisplayLabel(a1);\n                }\n                if (!isGlobal && isProcessNode(name)) return processDisplayLabel(name);\n                return name;',
  );
  out = out.replace(
    /formatter: function\(params\) \{\s*return params\.name;\s*\}/g,
    'formatter: function(params) {\n                if (!isGlobal && isProcessNode(params.name)) return processDisplayLabel(params.name);\n                return params.name;\n              }',
  );
  out = out.replace(
    /formatter: function\(params\) \{\s*if \(!isGlobal && isProcessNode\(params\.name\)\) return processDisplayLabel\(params\.name\);\s*return params\.name;\s*\}/g,
    'formatter: function(params) {\n                if (!isGlobal) {\n                  var a1 = a1Rows.find(function(r) { return r[0] === params.name; });\n                  if (a1) return a1DisplayLabel(a1);\n                  if (isProcessNode(params.name)) return processDisplayLabel(params.name);\n                }\n                return params.name;\n              }',
  );
  out = out.replace(
    /label:\{fontSize:12,color:'#e2e8f0',fontWeight:500\}/g,
    "label:{fontSize:12,color:'#e2e8f0',fontWeight:500,formatter:function(p){if(p.data&&p.data._type==='L3')return processDisplayLabel(p.name);return p.name;}}",
  );

  out = out.replace(/esc\(row\.process\)/g, 'esc(processDisplayLabel(row))');
  out = out.replace(/esc\(row\.proc\)/g, 'esc(processDisplayLabel(row))');
  out = out.replace(/'<td class="col-proc">' \+ esc\(a1\[14\]\) \+ '<\/td>'/g, '\'<td class="col-proc">\' + esc(processDisplayLabel(a1[14])) + \'</td>\'');
  out = out.replace(/'<td class="col-proc">' \+ esc\(a1\[11\]\) \+ '<\/td>'/g, '\'<td class="col-proc">\' + esc(processDisplayLabel(a1[11])) + \'</td>\'');
  out = out.replace(/'<td class="col-proc">' \+ esc\(l3NameMap\[a1\[11\]\] \|\| a1\[11\]\) \+ '<\/td>'/g, '\'<td class="col-proc">\' + esc(processDisplayLabel(a1[11])) + \'</td>\'');
  out = out.replace(/var l3NameMap = \{\};/g, 'var l3NameMap = typeof l3NameMap !== "undefined" && l3NameMap ? l3NameMap : {};');
  out = out.replace(/'<td class="col-a1name">' \+ esc\(a1\[1\]\) \+ '<\/td>'/g, '\'<td class="col-a1name">\' + esc(a1ShortCode(a1) + " " + a1[1]) + \'</td>\'');
  out = out.replace(
    /<td>'\+esc\(r\[13\]\)\+'<\/td><td>'\+esc\(r\[14\]\)\+'<\/td><td>'\+esc\(r\[1\]\)\+warn/g,
    "<td>'+esc(r[13])+'</td><td>'+esc(processDisplayLabel(r[14]))+'</td><td>'+esc(a1ShortCode(r)+' '+r[1])+warn",
  );

  return out;
}

const files = readdirSync(NORMS)
  .filter(name => name.endsWith('部门能力流程系统桑基图.html'))
  .map(name => join(NORMS, name));

let changed = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf-8');
  const after = normalizeText(before);
  if (after !== before) {
    writeFileSync(file, after, 'utf-8');
    changed += 1;
  }
}

console.log(`normalized ${changed}/${files.length} department Sankey pages`);
