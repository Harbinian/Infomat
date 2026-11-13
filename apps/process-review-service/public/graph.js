import {routeOrthogonal,segmentStyle} from './orthogonal.js';
import {describeActor,classifyHandoffs} from './handoffs.js';
import {layoutSwimlanes,mountLaneBackdrop,LANE_GUTTER} from './swimlanes.js';
import {stepTypes} from './walk-edits.js';

let graphInstance = null;
let pluginRegistered = false;
let laneBackdrop = null;

export function classifyWalkEntries(steps, relations) {
  if (!steps.length) return { entry: null, candidates: [], reason: 'empty' };
  const outgoing = new Map();
  const incoming = new Set();
  for (const step of steps) {
    const reference = step?.behavior_ref;
    if (typeof reference !== 'string' || !reference || outgoing.has(reference)) {
      return { entry: null, candidates: [], reason: 'references' };
    }
    outgoing.set(reference, []);
  }
  for (const relation of relations) {
    const from = relation?.from_behavior_ref;
    const to = relation?.to_behavior_ref;
    if (!outgoing.has(from) || !outgoing.has(to)) return { entry: null, candidates: [], reason: 'references' };
    outgoing.get(from).push(to);
    incoming.add(to);
  }
  const candidates = steps.filter(step => !incoming.has(step.behavior_ref));
  if (!candidates.length) return { entry: null, candidates, reason: 'cycle' };
  if (candidates.length > 1) return { entry: null, candidates, reason: 'multiple' };
  const [entry] = candidates;
  const reachable = new Set([entry.behavior_ref]);
  for (const reference of reachable) {
    for (const next of outgoing.get(reference)) reachable.add(next);
  }
  return reachable.size === steps.length ? { entry, candidates, reason: 'unique' }
    : { entry: null, candidates, reason: 'disconnected' };
}

export function destroyGraph() {
  laneBackdrop?.destroy();laneBackdrop=null;
  graphInstance?.destroy();
  graphInstance = null;
}

export function mountGraph(container, document, handlers = {}) {
  destroyGraph();
  const warnings = [];
  if (!window.cytoscape || !window.dagre) {
    container.textContent = '本地图形组件尚未加载，请检查服务资源后重试。';
    return { warnings: ['本地图形组件不可用'],lanes:[],fit(){},focus(){},zoom(){},resize(){},handoffFocus(){},focusRelation(){},focusLane(){},reset(){} };
  }
  if (!pluginRegistered && window.cytoscapeDagre) {
    window.cytoscape.use(window.cytoscapeDagre);
    pluginRegistered = true;
  }
  const behaviors = Array.isArray(document.behaviors) ? document.behaviors : [];
  const relations = Array.isArray(document.flow_relations) ? document.flow_relations : [];
  const entryInfo = classifyWalkEntries(behaviors, relations);
  const { entry } = entryInfo;
  const handoffs=classifyHandoffs(document,handlers.departments||[],handlers.actorRoles);
  const referenceMap = new Map();
  behaviors.forEach((behavior, index) => {
    const references = referenceMap.get(behavior.behavior_ref) || [];
    references.push(`node-${index}`);
    referenceMap.set(behavior.behavior_ref, references);
  });
  for (const [reference, matches] of referenceMap) {
    if (!reference || matches.length > 1) warnings.push(`节点标识${reference ? `“${reference}”` : '为空'}，关联关系需要核对。`);
  }
  const elements = behaviors.map((behavior, index) => {
    const name=behavior.behavior_name||'未命名步骤',actor=describeActor(behavior,handlers.departments||[],handlers.actorRoles);
    const title=behavior===entry?`入口 · ${name}`:name;
    const parallel=behavior.node_type==='parallel_split'||behavior.node_type==='parallel_join';
    const kindLabel=parallel?`${stepTypes.find(item=>item.value===behavior.node_type).label} · `:'';
    const label=`${title}\n〔${kindLabel}${actor.department||'部门待核对'}〕`;
    const units=[...title].reduce((sum,character)=>sum+(character.charCodeAt(0)>255?1:.55),0);
    const decision=behavior.node_type==='decision';
    const height=decision?Math.max(148,(Math.ceil(units/8)+1)*20+62):Math.max(90,(Math.ceil(units/11)+1)*20+28);
    return {classes:behavior===entry?'walk-entry':'',data:{id:`node-${index}`,label,height,department:actor.department,kind:behavior.node_type||'activity',reference:behavior.behavior_ref||'',original:behavior}};
  });
  relations.forEach((relation, index) => {
    const from = referenceMap.get(relation.from_behavior_ref);
    const to = referenceMap.get(relation.to_behavior_ref);
    if (from?.length !== 1 || to?.length !== 1) {
      warnings.push(`关系 ${index + 1} 的起点或终点缺失/不唯一，未能定位；原关系仍完整保留。`);
      return;
    }
    const condition=relation.condition||'';
    const handoff=handoffs[index];
    elements.push({ classes:`handoff-${handoff.kind}`,data: { id: `edge-${index}`, source: from[0], target: to[0],logicalIndex:index,handoffKind:handoff.kind,
      label: [...condition].length>12?[...condition].slice(0,11).join('')+'…':condition|| (handoff.kind==='cross'?'跨部门交接':''), reference: relation.relation_ref || '', original: relation } });
  });
  graphInstance = window.cytoscape({
    container, elements, minZoom: .02, maxZoom: 2.4, autoungrabify:true,
    style: [
      { selector: 'node', style: { 'shape': 'round-rectangle', 'width': 172, 'height': 'data(height)',
        'background-color': '#ffffff', 'border-width': 1.5, 'border-color': '#aac0de',
        'label': 'data(label)', 'font-size': 14, 'font-family': 'Microsoft YaHei', 'color': '#2b4569',
        'text-wrap': 'wrap', 'text-overflow-wrap': 'anywhere', 'text-max-width': 148, 'text-valign': 'center', 'text-halign': 'center',
        'padding': 6, 'text-outline-color': '#ffffff', 'text-outline-width': 1 } },
      { selector: 'node[kind = "decision"]', style: { 'shape': 'diamond', 'width': 196,
        'background-color': '#fff9e8', 'border-color': '#d9b965', 'text-max-width': 126, 'font-size': 13 } },
      { selector: 'node[kind = "parallel_split"], node[kind = "parallel_join"]', style: {
        'background-color': '#edf7fc', 'border-color': '#5593b2', 'border-style': 'dashed' } },
      { selector: 'node[kind = "start"], node[kind = "end"]', style: { 'shape': 'ellipse',
        'background-color': '#edf8f4', 'border-color': '#8dbeb1', 'width': 172, 'height': 'data(height)' } },
      { selector: 'node.walk-entry', style: { 'background-color': '#e4f5ee', 'border-color': '#087d68', 'border-width': 3 } },
      { selector: 'edge', style: { 'width': 1.8, 'line-color': '#839ab8', 'target-arrow-color': '#839ab8',
        'target-arrow-shape': 'triangle', 'curve-style': 'taxi', 'taxi-direction':'horizontal', 'label': 'data(label)',
        'font-size': 12, 'color': '#415978', 'text-wrap': 'wrap', 'text-overflow-wrap': 'anywhere', 'text-max-width': 100,
        'text-background-color': '#f7faff', 'text-background-opacity': .95, 'text-background-padding': 3,
        'text-rotation': 'none','line-outline-width':2,'line-outline-color':'#ffffff' } },
      { selector: 'node.related', style: {'border-color':'#488caa','background-color':'#f0fafb'} },
      { selector: 'edge.related', style: {'line-color':'#2568c7','target-arrow-color':'#2568c7','width':2.6,'z-index':5} },
      { selector: 'edge.handoff-cross', style: {'line-color':'#087f78','target-arrow-color':'#087f78','width':3,'color':'#086e68'} },
      { selector: 'edge.handoff-pending', style: {'line-color':'#aa7c32','target-arrow-color':'#aa7c32','line-style':'dashed','line-dash-pattern':[7,5]} },
      { selector: '.handoff-muted', style: {'opacity':.18} },
      { selector: '.dimmed', style: {'opacity':.3} },
      { selector: 'node:selected', style: { 'border-color': '#2863d6', 'border-width': 3,'background-color': '#eaf2ff' } },
      { selector: 'edge:selected', style: { 'width': 3,'line-color': '#2863d6', 'target-arrow-color': '#2863d6','z-index':6 } },
      { selector: 'edge.handoff-cross:selected', style: {'line-color':'#006c64','target-arrow-color':'#006c64','width':4} },
      { selector: 'node.routing-point', style: {'width':1,'height':1,'padding':0,'border-width':0,'opacity':0,'events':'no','label':''} }
    ],
    layout: { name: 'dagre', rankDir: 'LR', nodeSep: 70, rankSep: 110, edgeSep: 30, padding: 35, fit: false }
  });
  const cy=graphInstance;
  const swimlanes=layoutSwimlanes(cy.nodes().map(node=>({id:node.id(),...node.position(),department:node.data('department'),width:node.outerWidth(),height:node.outerHeight()})));
  cy.batch(()=>{for(const lane of swimlanes.lanes)for(const id of lane.nodeIds){const node=cy.getElementById(id);node.position(swimlanes.positions.get(id));node.data('laneId',lane.id);}});
  cy.scratch('reviewLanes',swimlanes.lanes);
  const nodes=cy.nodes().map(node=>({id:node.id(),...node.position(),width:node.outerWidth(),height:node.outerHeight(),kind:node.data('kind')}));
  const routes=routeOrthogonal(nodes,cy.edges().map(edge=>({id:edge.id(),source:edge.source().id(),target:edge.target().id()})));
  const labels=[];
  for(const route of routes){
    const edge=cy.getElementById(route.id);
    if(route.error){warnings.push(`关系${edge.data('reference')||route.id}：${route.error}，请从关系详情核对。`);edge.style('visibility','hidden');continue;}
    edge.data('routePoints',route.points);
    if(route.source===route.target){
      const split=Math.floor(route.points.length/2),pivot=route.points[split],data={...edge.data()};
      const helper=`loop-${route.id}`;
      cy.add({group:'nodes',data:{id:helper},position:pivot,classes:'routing-point'});
      edge.remove();
      const first=cy.add({group:'edges',classes:`handoff-${data.handoffKind}`,data:{...data,target:helper,routePoints:route.points.slice(0,split+1)}});
      const last=cy.add({group:'edges',classes:`handoff-${data.handoffKind}`,data:{...data,id:`${route.id}-return`,source:helper,label:'',routePoints:route.points.slice(split)}});
      first.style({...segmentStyle(first.data('routePoints'),first.source().position(),pivot),'target-arrow-shape':'none'});
      last.style(segmentStyle(last.data('routePoints'),pivot,last.target().position()));
    }else edge.style(segmentStyle(route.points,edge.source().position(),edge.target().position()));
  }
  cy.elements().boundingBox();
  for(const edge of cy.edges()){
    if(!edge.data('label'))continue;
    const points=edge.data('routePoints');if(!points)continue;
    const labelWidth=Math.min(100,[...edge.data('label')].length*12)+12;
    const labelHeight=Math.ceil([...edge.data('label')].length*12/100)*15+8;
    const candidates=[];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],horizontal=Math.abs(a.y-b.y)<.01;
      for(const fraction of [.5,.3,.7]){
        const x=a.x+(b.x-a.x)*fraction,y=a.y+(b.y-a.y)*fraction;
        for(const offset of [-1,1,-2,2,-3,3,-4,4]){
          const p={x:x+(horizontal?0:offset*(labelWidth/2+6)),y:y+(horizontal?offset*(labelHeight/2+5):0)};
          const box={x1:p.x-labelWidth/2,x2:p.x+labelWidth/2,y1:p.y-labelHeight/2,y2:p.y+labelHeight/2};
          const overlap=other=>box.x1<other.x2&&box.x2>other.x1&&box.y1<other.y2&&box.y2>other.y1;
          const blocked=nodes.some(n=>overlap({x1:n.x-n.width/2-3,x2:n.x+n.width/2+3,y1:n.y-n.height/2-3,y2:n.y+n.height/2+3}));
          if(!blocked)candidates.push({p,box,score:labels.filter(overlap).length*10000-(Math.abs(a.x-b.x)+Math.abs(a.y-b.y))+(horizontal?0:30)+Math.abs(offset)*80});
        }
      }
    }
    candidates.sort((a,b)=>a.score-b.score);
    const selected=candidates[0];
    if(selected){const mid=edge.midpoint();if(mid){edge.style({'text-margin-x':selected.p.x-mid.x,'text-margin-y':selected.p.y-mid.y});labels.push(selected.box);}}
  }
  let handoffFocus=false;
  function emphasize(elements){
    cy.elements().removeClass('dimmed related handoff-muted').unselect();
    if(handoffFocus)cy.edges('.handoff-internal').addClass('handoff-muted');
    if(!elements?.length)return;
    const related=elements.union(elements.nodes().connectedEdges()).union(elements.edges().connectedNodes());
    const neighborhood=related.union(related.edges().connectedNodes());
    cy.elements().difference(neighborhood).addClass('dimmed');neighborhood.removeClass('handoff-muted').addClass('related');elements.select();
  }
  let overview=true;
  cy.on('tap', 'node', event => {if(event.target.hasClass('routing-point'))return;overview=false;emphasize(event.target);handlers.onNode?.(event.target.data('original'));});
  cy.on('tap', 'edge', event => {overview=false;emphasize(event.target);handlers.onEdge?.(event.target.data('original'));});
  cy.on('dragpan scrollzoom',()=>{overview=false;});
  laneBackdrop=mountLaneBackdrop(container,cy,swimlanes);
  function center(elements){
    const box=elements.boundingBox({includeLabels:true,includeOverlays:false});
    cy.pan({x:LANE_GUTTER+(container.clientWidth-LANE_GUTTER)/2-(box.x1+box.x2)/2*cy.zoom(),y:container.clientHeight/2-(box.y1+box.y2)/2*cy.zoom()});
  }
  function fit(elements=cy.elements(),allLanes=false){
    if(!elements.length)return;
    const box=elements.boundingBox({includeLabels:true,includeOverlays:false});
    if(allLanes){box.y1=Math.min(box.y1,0);box.y2=Math.max(box.y2,swimlanes.height);}
    const width=Math.max(1,container.clientWidth-LANE_GUTTER-48),height=Math.max(1,container.clientHeight-36);
    const zoom=Math.max(cy.minZoom(),Math.min(1.1,width/Math.max(1,box.x2-box.x1),height/Math.max(1,box.y2-box.y1)));
    cy.zoom(zoom);cy.pan({x:LANE_GUTTER+24+(width-(box.x2-box.x1)*zoom)/2-box.x1*zoom,y:18+(height-(box.y2-box.y1)*zoom)/2-box.y1*zoom});
  }
  fit(cy.elements(),true);
  function focusNode(node){
    if(node.length!==1)return;
    overview=false;
    emphasize(node);
    if(cy.zoom()<1)cy.zoom(1);
    center(node);
  }
  return {
    warnings,entryInfo,lanes:swimlanes.lanes,
    resize: () => {const selected=cy.elements(':selected');cy.resize();if(overview)fit(cy.elements(),true);else if(selected.length)center(selected);},
    handoffFocus: enabled => {const selected=cy.elements(':selected');handoffFocus=enabled;emphasize(selected);},
    focusRelation:index=>{const selected=cy.edges().filter(edge=>edge.data('logicalIndex')===index);if(!selected.length)return;overview=false;emphasize(selected);fit(selected.union(selected.connectedNodes()));},
    focusLane:id=>{const lane=swimlanes.lanes.find(item=>item.id===id);if(!lane)return;overview=false;const nodes=cy.nodes().filter(node=>node.data('laneId')===id);emphasize(nodes);fit(nodes);},
    fit: () => {overview=true;emphasize(null);fit(cy.elements(),true);},
    reset: () => emphasize(null),
    zoom: amount => {overview=false;cy.zoom({level:cy.zoom()*amount,renderedPosition:{x:LANE_GUTTER+(container.clientWidth-LANE_GUTTER)/2,y:container.clientHeight/2}});},
    focus: reference => {if(reference)focusNode(cy.nodes().filter(item=>item.data('reference')===reference));},
    focusStep: index => focusNode(cy.getElementById(`node-${index}`))
  };
}
