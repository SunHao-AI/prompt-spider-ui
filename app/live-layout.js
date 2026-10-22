const box = (x, y, w, h) => Object.freeze({ x, y, w, h });
export const PAGE_SIZE = 32;
export const LIVE_LAYOUTS = Object.freeze({
  portrait: Object.freeze({ width:1080, height:1350, scene:box(40,130,1000,850), stream:box(40,1000,630,300), stats:box(690,1000,350,300) }),
  // landscape 专属 probes: 参考演示底部四格探针带(置信度/时间线/覆盖率/分支账本),
  // 由 scene 让出纵向空间(730→550), 四格与场景左右缘对齐、底边与右列 stats 对齐。
  landscape: Object.freeze({ width:1600, height:900, scene:box(40,125,1080,570), stream:box(1140,125,420,410), stats:box(1140,555,420,300), probes:Object.freeze([box(40,710,262,160),box(313,710,262,160),box(586,710,262,160),box(859,710,261,160)]) }),
  square: Object.freeze({ width:1080, height:1080, scene:box(40,130,1000,730), stream:null, stats:box(40,880,1000,150) }),
  // 词墙(参考演示同款观感): 与 landscape 同页, 但事件铺成中部多列词墙、蜘蛛轨道压在墙上。
  wall: Object.freeze({ width:1600, height:900, scene:box(40,125,1080,730), stream:box(1140,125,420,410), stats:box(1140,555,420,300) }),
});

// 词墙区(仅 wall 布局): 场景左侧窄编辑列(参考演示的终端编辑器观感), 避开右缘分箱列与标题带。
export function wallArea(s) { return box(s.x + 18, s.y + 31, s.w * .40, s.h - 32); }
export const WALL_ROW = 20;                 // 词墙行高(px)
export const WALL_GUTTER = 46;              // 词墙左侧行号槽宽(px)
export const WALL_HEAD = 30;                // 词墙终端标题栏高(px)
const CJK = /[\u1100-\u206F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
// 等宽字体近似宽度: CJK 记双宽(纯函数层无 canvas 度量)。
export function tokenWidth(text, char = 7.2) {
  let w = 0;
  for (const ch of String(text)) w += CJK.test(ch) ? char * 2 : char;
  return w;
}
// 确定性伪随机(与参考渲染层 fract 版 random 同分布): 决定词元框用"实心"还是"描边"样式。
export const pseudoRandom = seed => { const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453123; return v - Math.floor(v); };

export function eventPlacement(layout, events, measure = label => tokenWidth(label)) {
  const s = layout.scene;
  if (layout === LIVE_LAYOUTS.wall) {
    // 流式换行词墙(参考演示同款): 词元从左到右排布、超宽换行; y 是未滚动的文字基线,
    // 渲染层按阅读进度对整面墙做垂直缓动滚动(observe: 新词到达时墙向上滚)。
    const a = wallArea(s), gutter = a.x + WALL_GUTTER, maxWidth = a.w - WALL_GUTTER - 18;
    const regions = [];
    let x = gutter, row = 0;
    for (let index = 0; index < Math.min(events.length, PAGE_SIZE); index++) {
      const event = events[index];
      const text = String(event.displayLabel ?? event.label ?? event.id);
      const w = Math.min(maxWidth, Math.max(28, measure(text) + 6));
      if (x > gutter && x - gutter + w > maxWidth) { x = gutter; row += 1; }
      regions.push({ event, text, x, y: a.y + WALL_HEAD + 26 + row * WALL_ROW, w, h: 16, index, row,
                     cy: a.y + WALL_HEAD + 26 + row * WALL_ROW - 4.5 });
      x += w + 7;
    }
    return regions;
  }
  const spacing=Math.min(22,(s.h-110)/PAGE_SIZE);
  return events.slice(0,PAGE_SIZE).map((event,index)=>({event,x:s.x+35,y:s.y+79+index*spacing,w:s.w*.30,h:spacing-2,index}));
}
// 词团实际 bbox(供 livePose 对准): 由本可见页的 regions 反推, 翻页/过滤后轨道随之收敛。
// 中心一律用 cy(wall 的 y 是文字基线, 其余布局 cy 缺省回落 y)。
export function tightBox(regions) {
  if(!regions.length)return null;
  const center=r=>r.cy??r.y;
  const x0=Math.min(...regions.map(r=>r.x)), x1=Math.max(...regions.map(r=>r.x+r.w));
  const y0=Math.min(...regions.map(r=>center(r)-r.h/2)), y1=Math.max(...regions.map(r=>center(r)+r.h/2));
  return box(x0,y0,x1-x0,y1-y0);
}
export function hitEvent(regions,x,y) {
  return regions.find(region=>{const cy=region.cy??region.y;return x>=region.x && x<=region.x+region.w && y>=cy-region.h/2 && y<=cy+region.h/2;})?.event.id ?? null;
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
// 词墙垂直滚动目标(参考演示的编辑器滚动): 让"焦点行"停在可视区约 42% 高度处,
// 新词到达时整墙平滑上移; 行数不足一屏时返回 0(不滚动, 词团留在顶部)。
export function wallScrollTarget(regions, area) {
  if (!regions.length) return 0;
  const focusY = Math.max(...regions.map(r => r.y));
  const visible = area.h - WALL_HEAD - 8;
  return Math.max(0, focusY - WALL_HEAD - 8 - visible * .42);
}
// 滚动量帧率无关指数平滑(与 easeOrbit 同一节奏): 目标跳一行, 墙滑过去而不是跳过去。
export function easeValue(current, target, dt, tau = 0.4) {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
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
