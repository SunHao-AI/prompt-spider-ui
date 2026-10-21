const box = (x, y, w, h) => Object.freeze({ x, y, w, h });
export const PAGE_SIZE = 32;
export const LIVE_LAYOUTS = Object.freeze({
  portrait: Object.freeze({ width:1080, height:1350, scene:box(40,130,1000,850), stream:box(40,1000,630,300), stats:box(690,1000,350,300) }),
  landscape: Object.freeze({ width:1600, height:900, scene:box(40,125,1080,730), stream:box(1140,125,420,410), stats:box(1140,555,420,300) }),
  square: Object.freeze({ width:1080, height:1080, scene:box(40,130,1000,730), stream:null, stats:box(40,880,1000,150) }),
  // 词墙(参考演示同款观感): 与 landscape 同页, 但事件铺成中部多列词墙、蜘蛛轨道压在墙上。
  wall: Object.freeze({ width:1600, height:900, scene:box(40,125,1080,730), stream:box(1140,125,420,410), stats:box(1140,555,420,300) }),
});

// 词墙区(仅 wall 布局): 场景中部 ~62% 宽度多列网格, 避开右缘分箱列(routeTarget .875)与标题带。
export function wallArea(s) { return box(s.x + s.w * .10, s.y + 68, s.w * .62, s.h - 105); }

export function eventPlacement(layout, events) {
  const s=layout.scene;
  if (layout === LIVE_LAYOUTS.wall) {
    const a=wallArea(s), n=Math.min(events.length,PAGE_SIZE);
    const cols=Math.max(1,Math.min(3,Math.ceil(n/Math.ceil(n/3))));           // 3~4 行自适应列数
    const rows=Math.ceil(n/cols), cw=a.w/cols, ch=Math.min(46,a.h/Math.max(1,rows));  // 行高封顶: 事件少时词团紧凑在顶部, 不拉伸铺满(否则行间大空白, 蜘蛛像在空处转圈)
    return events.slice(0,PAGE_SIZE).map((event,i)=>({event,
      x:a.x+(i%cols)*cw+cw*.06, y:a.y+8+Math.floor(i/cols)*ch+ch*.5,
      w:cw*.88,h:Math.min(24,ch-8),index:i}));
  }
  const spacing=Math.min(22,(s.h-110)/PAGE_SIZE);
  return events.slice(0,PAGE_SIZE).map((event,index)=>({event,x:s.x+35,y:s.y+79+index*spacing,w:s.w*.30,h:spacing-2,index}));
}
// 词团实际 bbox(供 livePose 对准): 由本可见页的 regions 反推, 翻页/过滤后轨道随之收敛。
export function tightBox(regions) {
  if(!regions.length)return null;
  const x0=Math.min(...regions.map(r=>r.x)), x1=Math.max(...regions.map(r=>r.x+r.w));
  const y0=Math.min(...regions.map(r=>r.y-r.h/2)), y1=Math.max(...regions.map(r=>r.y+r.h/2));
  return box(x0,y0,x1-x0,y1-y0);
}
export function hitEvent(regions,x,y) {
  return regions.find(region=>x>=region.x && x<=region.x+region.w && y>=region.y-region.h/2 && y<=region.y+region.h/2)?.event.id ?? null;
}
export function routeTarget(layout,route) {
  const s=layout.scene,index=['code','model','ext','you'].indexOf(route);
  return {x:s.x+s.w*.875,y:s.y+s.h*(.15+Math.max(0,index)*.235)};
}

// 轨道参数(椭圆中心+半径): wall 对准词团实际 bbox(缺省回落 wallArea), 其余布局用场景比例。
// 从 livePose 抽出, 供渲染层缓动(参数连续变化 => 位置连续, 蜘蛛不再瞬移)。
export function orbitTarget(layout, tight=null) {
  const s=layout.scene;
  if(layout===LIVE_LAYOUTS.wall){const a=tight??wallArea(s);return {cx:a.x+a.w*.5,cy:a.y+a.h*.5,rx:a.w*.42,ry:Math.max(60,a.h*.42)};}
  return {cx:s.x+s.w*.39,cy:s.y+s.h*.50,rx:s.w*.075,ry:s.h*.33};
}
// Closed analytic orbit: position AND velocity join smoothly, at any elapsed time.
export function poseFromOrbit({cx,cy,rx,ry},time,omega,reducedMotion=false) {
  const angle=reducedMotion?1.3:time*omega;
  return {x:cx+Math.cos(angle)*rx,y:cy+Math.sin(angle)*ry,vx:-Math.sin(angle)*rx*omega,vy:Math.cos(angle)*ry*omega};
}
// 轨道参数帧率无关指数平滑: k=1-exp(-dt/τ)。目标突变时参数连续逼近, 观感为蜘蛛巡游过去而非跳过去。
export function easeOrbit(current,target,dt,tau=0.35) {
  const k=1-Math.exp(-Math.max(0,dt)/tau);
  const mix=(a,b)=>a+(b-a)*k;
  return {cx:mix(current.cx,target.cx),cy:mix(current.cy,target.cy),rx:mix(current.rx,target.rx),ry:mix(current.ry,target.ry)};
}
export function livePose(layout,time,reducedMotion=false,tight=null) {
  const omega=reducedMotion?0:Math.PI*2/16;
  return poseFromOrbit(orbitTarget(layout,tight),time,omega,reducedMotion);
}
export function resolveCursor(meta,sinceAnchorMs=0) {
  const playback=meta.playback,delta=Math.max(0,sinceAnchorMs)/1000;
  if (playback.mode==='live') return playback.position+delta;
  if (playback.mode==='paused') return playback.position;
  const position=playback.position+delta*playback.speed;
  const live=meta.status==='live'&&meta.source!=='replay';
  const maximum=live?meta.elapsed+delta:meta.duration;
  return playback.loop && !live && maximum>0 ? position%maximum : Math.min(maximum,position);
}
export function parseSseFrames(input) {
  const normalized=input.replace(/\r\n/g,'\n'),parts=normalized.split('\n\n'),rest=parts.pop(),messages=[];
  for(const frame of parts) {
    const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(data) messages.push(JSON.parse(data));
  }
  return {messages,rest};
}
export function alpha(hex,value) {
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${value})`;
}
