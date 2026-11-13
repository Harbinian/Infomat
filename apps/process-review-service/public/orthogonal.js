// Routes are display geometry only. Source process facts and relation IDs stay unchanged.
const EPSILON = .01;
const same = (a,b) => Math.abs(a-b)<EPSILON;
const length = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function simplify(points) {
  const result=[];
  for(const point of points){
    if(result.length&&length(result.at(-1),point)<EPSILON)continue;
    while(result.length>1){
      const a=result.at(-2),b=result.at(-1);
      if((same(a.x,b.x)&&same(b.x,point.x))||(same(a.y,b.y)&&same(b.y,point.y)))result.pop();else break;
    }
    result.push(point);
  }
  return result;
}
function blocked(a,b,box){
  if(same(a.x,b.x))return a.x>box.x1+EPSILON&&a.x<box.x2-EPSILON&&Math.max(a.y,b.y)>box.y1+EPSILON&&Math.min(a.y,b.y)<box.y2-EPSILON;
  return a.y>box.y1+EPSILON&&a.y<box.y2-EPSILON&&Math.max(a.x,b.x)>box.x1+EPSILON&&Math.min(a.x,b.x)<box.x2-EPSILON;
}
class Queue {
  items=[];
  push(item){let i=this.items.length;this.items.push(item);while(i){const p=(i-1)>>1;if(this.items[p].score<=item.score)break;this.items[i]=this.items[p];i=p;}this.items[i]=item;}
  pop(){const first=this.items[0],last=this.items.pop();if(this.items.length){let i=0;while(i*2+1<this.items.length){let child=i*2+1;if(child+1<this.items.length&&this.items[child+1].score<this.items[child].score)child++;if(this.items[child].score>=last.score)break;this.items[i]=this.items[child];i=child;}this.items[i]=last;}return first;}
}
function buildRoutes(nodes,edges,settings={}){
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const clearance=24;
  const boxes=nodes.map(n=>({x1:n.x-n.width/2-12,x2:n.x+n.width/2+12,y1:n.y-n.height/2-12,y2:n.y+n.height/2+12}));
  const ports=new Map();
  for(const node of nodes){
    for(const side of ['source','target']){
      const other=side==='source'?'target':'source';
      const connected=edges.filter(edge=>edge[side]===node.id).sort((a,b)=>byId.get(a[other]).y-byId.get(b[other]).y||a.id.localeCompare(b.id));
      connected.forEach((edge,i)=>{
        const offset=settings.sharedPorts?0:(i-(connected.length-1)/2)*Math.min(14,(node.height-28)/Math.max(1,connected.length-1));
        const halfWidth=node.width/2;
        const inset=node.kind==='decision'?halfWidth*Math.abs(offset)/(node.height/2):0;
        const sign=side==='source'?1:-1;
        const point={x:node.x+sign*(halfWidth-inset),y:node.y+offset};
        const stub={x:node.x+sign*(halfWidth+clearance),y:point.y};
        const entry=ports.get(edge.id)||{};entry[side]={point,stub};ports.set(edge.id,entry);
      });
    }
  }
  const backward=settings.internalReturns?[]:edges.filter(edge=>byId.get(edge.target).x<=byId.get(edge.source).x);
  const top=Math.min(...nodes.map(n=>n.y-n.height/2)),bottom=Math.max(...nodes.map(n=>n.y+n.height/2));
  const lanes={top:[],bottom:[]},returnY=new Map();
  for(const edge of backward.sort((a,b)=>Math.abs(byId.get(a.source).x-byId.get(a.target).x)-Math.abs(byId.get(b.source).x-byId.get(b.target).x))){
    const source=byId.get(edge.source),target=byId.get(edge.target),side=(source.y+target.y)/2<(top+bottom)/2?'top':'bottom';
    const interval=[target.x-target.width/2-48,source.x+source.width/2+48];
    let lane=lanes[side].findIndex(entries=>entries.every(([a,b])=>b<interval[0]||a>interval[1]));
    if(lane<0){lane=lanes[side].length;lanes[side].push([]);}lanes[side][lane].push(interval);
    returnY.set(edge.id,side==='top'?top-50-lane*20:bottom+50+lane*20);
  }
  const xs=[...new Set(nodes.flatMap(n=>[n.x-n.width/2-clearance,n.x+n.width/2+clearance,n.x-n.width/2-44,n.x+n.width/2+44]))].sort((a,b)=>a-b);
  const ys=[...new Set([...nodes.flatMap(n=>[n.y,n.y-n.height/2-clearance,n.y+n.height/2+clearance]),...[...ports.values()].flatMap(p=>[p.source.stub.y,p.target.stub.y]),...returnY.values()])].sort((a,b)=>a-b);
  const xIndex=new Map(xs.map((x,i)=>[x,i])),yIndex=new Map(ys.map((y,i)=>[y,i]));
  const width=xs.length,total=width*ys.length;
  const point=id=>({x:xs[id%width],y:ys[Math.floor(id/width)]});
  const index=p=>yIndex.get(p.y)*width+xIndex.get(p.x);
  const neighbors=new Map(),used=new Map(),occupied=[new Map(),new Map()];
  function next(id){
    if(neighbors.has(id))return neighbors.get(id);
    const x=id%width,y=Math.floor(id/width),a=point(id),result=[];
    for(const [nx,ny,dir] of [[x-1,y,0],[x+1,y,0],[x,y-1,1],[x,y+1,1]]){
      if(nx<0||nx>=width||ny<0||ny>=ys.length)continue;
      const nid=ny*width+nx,b=point(nid);
      if(!boxes.some(box=>blocked(a,b,box)))result.push({id:nid,dir,distance:length(a,b)});
    }
    neighbors.set(id,result);return result;
  }
  function search(start,end){
    const startId=index(start),endId=index(end),queue=new Queue();
    const distance=new Float64Array(total*2).fill(Infinity),previous=new Int32Array(total*2).fill(-1);
    distance[startId*2]=0;queue.push({key:startId*2,cost:0,score:length(start,end)});
    let found=-1;
    while(queue.items.length){
      const current=queue.pop();if(current.cost!==distance[current.key])continue;
      const id=current.key>>1,dir=current.key%2;
      if(id===endId){found=current.key;break;}
      for(const step of next(id)){
        const key=step.id*2+step.dir;
        const sharing=used.get([Math.min(id,step.id),Math.max(id,step.id)].join(':'))||0;
        const crossing=(occupied[1-step.dir].get(id)||0)+(occupied[1-step.dir].get(step.id)||0);
        const cost=current.cost+step.distance*(1+sharing*(settings.sharingPenalty??14))+(dir===step.dir?0:32)+crossing*(settings.crossingPenalty??160);
        if(cost>=distance[key])continue;
        distance[key]=cost;previous[key]=current.key;queue.push({key,cost,score:cost+length(point(step.id),end)});
      }
    }
    if(found<0)return null;
    const ids=[];for(let key=found;key>=0;key=previous[key])ids.push(key>>1);ids.reverse();
    return ids.map(point);
  }
  const results=new Map();
  const ordered=[...edges].sort((a,b)=>Number(returnY.has(a.id))-Number(returnY.has(b.id))||(settings.longFirst?-1:1)*(Math.abs(byId.get(a.target).x-byId.get(a.source).x)-Math.abs(byId.get(b.target).x-byId.get(b.source).x))||a.id.localeCompare(b.id));
  for(const edge of ordered){
    const port=ports.get(edge.id),start=port.source.stub,end=port.target.stub;
    let middle;
    if(returnY.has(edge.id)){
      const y=returnY.get(edge.id),a={x:start.x,y},b={x:end.x,y},first=search(start,a),last=search(b,end);
      middle=first&&last?[...first,b,...last]:null;
    }else middle=search(start,end);
    if(!middle){results.set(edge.id,{...edge,points:[],error:'无法生成避让路线'});continue;}
    // Register every grid interval, including the dedicated return channel.
    for(let i=1;i<middle.length;i++){
      const a=index(middle[i-1]),b=index(middle[i]);if(a===b)continue;
      const dir=same(middle[i-1].y,middle[i].y)?0:1,step=dir===0?Math.sign(b-a):Math.sign(b-a)*width;
      for(let id=a;id!==b;id+=step){const nextId=id+step,key=[Math.min(id,nextId),Math.max(id,nextId)].join(':');used.set(key,(used.get(key)||0)+1);occupied[dir].set(id,(occupied[dir].get(id)||0)+1);occupied[dir].set(nextId,(occupied[dir].get(nextId)||0)+1);}
    }
    results.set(edge.id,{...edge,points:simplify([port.source.point,...middle,port.target.point])});
  }
  return edges.map(edge=>results.get(edge.id));
}
function routeScore(routes){
  let crossings=0,overlapLength=0,overlapPairs=0;
  for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
    const a=routes[i],b=routes[j],common=[a.source,a.target].some(id=>[b.source,b.target].includes(id));
    const hits=new Set();let shared=0;
    for(let u=1;u<a.points.length;u++)for(let v=1;v<b.points.length;v++){
      const p=a.points[u-1],q=a.points[u],r=b.points[v-1],s=b.points[v],horizontal=same(p.y,q.y),otherHorizontal=same(r.y,s.y);
      if(horizontal!==otherHorizontal){
        const h=horizontal?[p,q]:[r,s],t=horizontal?[r,s]:[p,q],x=t[0].x,y=h[0].y;
        if(x>Math.min(h[0].x,h[1].x)+.1&&x<Math.max(h[0].x,h[1].x)-.1&&y>Math.min(t[0].y,t[1].y)+.1&&y<Math.max(t[0].y,t[1].y)-.1)hits.add(`${x.toFixed(2)},${y.toFixed(2)}`);
      }else if(same(horizontal?p.y:p.x,horizontal?r.y:r.x)){
        const key=horizontal?'x':'y';shared+=Math.max(0,Math.min(Math.max(p[key],q[key]),Math.max(r[key],s[key]))-Math.max(Math.min(p[key],q[key]),Math.min(r[key],s[key])));
      }
    }
    crossings+=hits.size;if(shared>.1)overlapPairs++;if(!common)overlapLength+=shared;
  }
  return crossings*250+overlapLength*.5+overlapPairs*12+routes.filter(route=>route.error).length*1e9;
}
export function routeOrthogonal(nodes,edges,settings){
  if(settings)return buildRoutes(nodes,edges,settings);
  if(!nodes.length||!edges.length)return [];
  // Choose geometry by crossings/overlap, never by business meaning or source order.
  const candidates=[{},{internalReturns:true},{sharedPorts:true},{sharedPorts:true,internalReturns:true},
    ...[false,true].flatMap(longFirst=>[true,false].map(sharedPorts=>({sharedPorts,internalReturns:true,longFirst,crossingPenalty:700})))];
  let best,score=Infinity;
  for(const config of candidates){const routes=buildRoutes(nodes,edges,config),value=routeScore(routes);if(value<score){best=routes;score=value;}if(value===0)break;}
  return best;
}
export function segmentStyle(points,source,target){
  const dx=target.x-source.x,dy=target.y-source.y,squared=dx*dx+dy*dy,magnitude=Math.sqrt(squared);
  const bends=points.slice(1,-1);
  // A midpoint keeps a straight cardinal edge compatible with the segments renderer.
  if(!bends.length)bends.push({x:(points[0].x+points.at(-1).x)/2,y:(points[0].y+points.at(-1).y)/2});
  return {'curve-style':'segments','edge-distances':'node-position',
    'segment-weights':bends.map(p=>((p.x-source.x)*dx+(p.y-source.y)*dy)/squared),
    'segment-distances':bends.map(p=>(dx*(p.y-source.y)-dy*(p.x-source.x))/magnitude),
    'source-endpoint':`${points[0].x-source.x}px ${points[0].y-source.y}px`,
    'target-endpoint':`${points.at(-1).x-target.x}px ${points.at(-1).y-target.y}px`};
}
