export const LANE_GUTTER = 142;

// Department membership comes from source classification. Packing changes only display coordinates.
export function layoutSwimlanes(nodes){
  const groups=new Map();
  for(const node of nodes){const key=node.department||'';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
  const keys=[...groups.keys()].filter(Boolean);if(groups.has(''))keys.push('');
  const lanes=[],positions=new Map();let top=0;
  for(const [index,department]of keys.entries()){
    const members=groups.get(department),tracks=[];
    const ordered=[...members].sort((a,b)=>a.x-b.x||a.y-b.y||a.id.localeCompare(b.id));
    for(const node of ordered){
      const left=node.x-node.width/2;
      let track=tracks.find(item=>item.right+48<=left);
      if(!track){track={right:-Infinity,height:0,nodes:[]};tracks.push(track);}
      track.nodes.push(node);track.right=node.x+node.width/2;track.height=Math.max(track.height,node.height);
    }
    const height=Math.max(170,76+tracks.reduce((sum,track)=>sum+track.height,0)+Math.max(0,tracks.length-1)*48);
    let rowTop=top+38;
    for(const track of tracks){for(const node of track.nodes)positions.set(node.id,{x:node.x,y:rowTop+track.height/2});rowTop+=track.height+48;}
    lanes.push({id:department?`department:${department}`:'pending',department,label:department||'待核对',pending:!department,index,y1:top,y2:top+height,nodeIds:members.map(node=>node.id)});
    top+=height+18;
  }
  return {lanes,positions,height:Math.max(0,top-18)};
}

export function mountLaneBackdrop(container,cy,layout){
  const doc=container.ownerDocument,svgNS='http://www.w3.org/2000/svg';
  const element=(name,attributes={})=>{const node=doc.createElementNS(svgNS,name);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
  const background=element('svg',{'aria-hidden':'true',class:'lane-background'});
  const headers=element('svg',{role:'img','aria-label':'部门泳道标题',class:'lane-headers'});
  background.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none';
  headers.style.cssText=`position:absolute;left:0;top:0;width:${LANE_GUTTER}px;height:100%;z-index:5;touch-action:none`;
  const palette=['#edf5fc','#eef8f4','#f5f2fc','#edf7f8','#f4f6ed','#fdf2ee'];
  const fullHeader=element('rect',{x:0,y:0,width:LANE_GUTTER,height:'100%',fill:'#f8fafd'});headers.append(fullHeader);
  const rows=layout.lanes.map(lane=>{
    const fill=lane.pending?'#fff6df':palette[lane.index%palette.length],stroke=lane.pending?'#d5b779':'#c9d9e8';
    const band=element('rect',{x:LANE_GUTTER,width:'100%',fill,stroke,'stroke-width':1,'fill-opacity':.57});
    const header=element('rect',{x:0,width:LANE_GUTTER,fill,stroke,'stroke-width':1});
    const label=element('text',{x:14,'font-family':'Microsoft YaHei','font-size':14,'font-weight':600,fill:lane.pending?'#885b17':'#345b7c'});
    label.textContent=lane.label;
    const note=element('text',{x:14,'font-family':'Microsoft YaHei','font-size':11,fill:lane.pending?'#a57c36':'#69829c'});note.textContent=`${lane.nodeIds.length} 个步骤${lane.pending?' · 归属未定':''}`;
    const title=element('title');title.textContent=`${lane.label}：${lane.nodeIds.length}个步骤，按材料所述归属展示。`;header.append(title);
    background.append(band);headers.append(header,label,note);return {lane,band,header,label,note};
  });
  if(!container.style.position)container.style.position='relative';
  container.insertBefore(background,container.firstChild);container.append(headers);
  const canvas=Array.from(container.children).find(node=>node!==background&&node!==headers&&node.querySelector?.('canvas'));
  const oldClip=canvas?.style.clipPath;if(canvas)canvas.style.clipPath=`inset(0 0 0 ${LANE_GUTTER}px)`;
  function draw(){
    const zoom=cy.zoom(),pan=cy.pan(),height=container.clientHeight;
    background.setAttribute('viewBox',`0 0 ${container.clientWidth} ${height}`);headers.setAttribute('viewBox',`0 0 ${LANE_GUTTER} ${height}`);
    for(const {lane,band,header,label,note}of rows){
      const y=lane.y1*zoom+pan.y,h=(lane.y2-lane.y1)*zoom,visibleTop=Math.max(0,y),visibleBottom=Math.min(height,y+h),visibleHeight=Math.max(0,visibleBottom-visibleTop);
      for(const rect of [band,header]){rect.setAttribute('y',y);rect.setAttribute('height',h);}
      const center=(visibleTop+visibleBottom)/2;
      label.setAttribute('y',center+(visibleHeight>=44?-2:4));label.setAttribute('font-size',visibleHeight>=26?14:12);note.setAttribute('y',center+18);
      label.style.display=visibleHeight>=12?'':'none';note.style.display=visibleHeight>=44?'':'none';
    }
  }
  cy.on('pan zoom resize',draw);draw();
  return {draw,destroy(){cy.off('pan zoom resize',draw);background.remove();headers.remove();if(canvas)canvas.style.clipPath=oldClip||'';}};
}
