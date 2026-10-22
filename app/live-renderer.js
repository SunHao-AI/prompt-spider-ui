import { LIVE_LAYOUTS, eventPlacement, hitEvent, routeTarget, orbitTarget, poseFromOrbit, easeOrbit, alpha, tightBox, wallArea, wallScrollTarget, easeValue, pseudoRandom, WALL_ROW, WALL_HEAD } from './live-layout.js';
import { legPose, heartbeatAt } from './spider.js';
import { probePose } from './probes.js';

const ROUTES=['code','model','ext','you'];
const STATUS={pending:'等待',running:'进行中',completed:'已完成',failed:'失败'};
const MONO='Consolas, "Cascadia Code", monospace';
const TOKEN_SIZE=11.5;                       // 词墙词元字号(与 eventPlacement 的宽度度量同源)
const TRAFFIC=['#ff685e','#ffc54c','#43c982'];// 终端红绿灯(参考演示 studio.prompt 观感)
export class LiveRenderer {
  constructor(canvas,{onSelect}={}) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.regions=[];
    // 命中路由由调用方(live.js)统一负责: 共享同一 canvas 的多渲染器不能各自挂 click, 否则陈旧命中区会误触发。
    if(typeof onSelect==='function'){this.handleClick=event=>{const id=this.hitTest(event.clientX,event.clientY);if(id!==null)onSelect?.(id);};canvas.addEventListener('click',this.handleClick);}
    this.orbit=null;this.orbitTime=0;this.orbitPos=null;this.orbitDt=0;   // wall 轨道缓动状态(参数+上帧时刻+上帧位置+本帧步长)
    this.wallScroll=0;this.wallScrollTime=0;this.wallScrollReady=false;    // 词墙垂直滚动量(终端编辑器观感)
    this.hoverId=null;this.pulse=null;                                     // 微交互: hover 命中 id + 点击扩散圆环(live.js 写入)
  }
  destroy(){if(this.handleClick)this.canvas.removeEventListener('click',this.handleClick);}
  hitTest(clientX,clientY){const r=this.canvas.getBoundingClientRect();if(!this.layout||!r.width||!r.height)return null;return hitEvent(this.regions,(clientX-r.left)/r.width*this.layout.width,(clientY-r.top)/r.height*this.layout.height);}
  resize(layout){
    const dpr=Math.min(2,Math.max(1,globalThis.devicePixelRatio||1));
    if(this.layout===layout && this.dpr===dpr && this.canvas.width===Math.round(layout.width*dpr) && this.canvas.height===Math.round(layout.height*dpr))return;
    this.layout=layout;this.dpr=dpr;this.regions=[];
    this.wallScroll=0;this.wallScrollReady=false;   // 切布局=新的滚动基准(首帧 snap, 不从旧布局滑过来)
    this.canvas.width=Math.round(layout.width*dpr);this.canvas.height=Math.round(layout.height*dpr);
    this.canvas.style.aspectRatio=`${layout.width} / ${layout.height}`;
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  text(value,x,y,color,size=12,align='left',bold=false){const c=this.ctx;c.font=`${bold?700:400} ${size}px ${MONO}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(String(value),x,y);c.textAlign='left';}
  label(value,maxWidth){const c=this.ctx;let text=String(value);while(text.length>1 && c.measureText(text).width>maxWidth)text=text.slice(0,-1);return text===String(value)?text:text.slice(0,-1)+'…';}
  line(x1,y1,x2,y2,color,width=1){const c=this.ctx;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  panel(rect,title,theme,right='') {
    const c=this.ctx,{x,y,w,h}=rect;c.fillStyle=theme.panel;c.fillRect(x,y,w,h);c.strokeStyle=theme.border;c.lineWidth=1;c.strokeRect(x+.5,y+.5,w-1,h-1);
    c.fillStyle=theme.panelTop;c.fillRect(x+1,y+1,w-2,30);this.text(title,x+13,y+20,theme.muted,11);this.text(right,x+w-12,y+20,theme.muted,10,'right');
  }
  measure(label){this.ctx.font=`400 ${TOKEN_SIZE}px ${MONO}`;return this.ctx.measureText(String(label)).width;}
  render(view,{time=view.at,reducedMotion=false,selectedId=null,page=0,routeFilter='all',connection='离线回放'}={}){
    const {config}=view,theme=config.theme,layout=LIVE_LAYOUTS[config.layout]||LIVE_LAYOUTS.portrait;this.resize(layout);
    const c=this.ctx;c.fillStyle=theme.background;c.fillRect(0,0,layout.width,layout.height);
    this.text(config.title,40,53,theme.text,27,'left',true);this.text(config.subtitle||'EVERY TASK, ONE FORK',40,79,theme.accent,12);
    this.text(connection,layout.width-40,48,theme.muted,10,'right');this.text(config.modelName,layout.width-40,76,config.routes.model.color,12,'right');
    const scene=layout.scene,wall=layout===LIVE_LAYOUTS.wall,area=wall?wallArea(scene):null;
    const placed=eventPlacement(layout,view.events,label=>this.measure(label));
    const filtered=placed.filter(x=>routeFilter==='all'||x.event.route===routeFilter);
    // 滚动先行(依据整页词团, 不受分支过滤影响), 再把命中区换算到滚动后的屏幕坐标。
    const scroll=wall?this.easeWallScroll(placed,area,reducedMotion):0;
    const screen=wall?filtered.map(region=>({...region,y:region.y-scroll,cy:region.cy-scroll})):filtered;
    // 蜘蛛轨道只对准滚动后仍可见的词团: 墙往上滚, 轨道跟着词团走。
    this.regions=wall?screen.filter(r=>r.cy>area.y+WALL_HEAD&&r.cy<area.y+area.h):screen;
    this.wallTight=wall?tightBox(this.regions):null;
    // 词墙布局: 场景面板只留右侧信息, 左半部让位给参考演示同款的终端编辑器。
    this.panel(scene,wall?'':config.unit==='word'?'PROMPT / TOKEN STREAM':'AGENT / TASK STREAM',theme,`PAGE ${page+1} · ${view.totalEvents} EVENTS`);
    this.mesh(theme);                                   // 蛛网底纹(编辑器之下, 右侧分箱之上)
    if(wall)this.editorChrome(area,theme,config,scroll);
    c.save();c.beginPath();c.rect(scene.x+1,scene.y+31,scene.w-2,scene.h-32);c.clip();
    if(wall){this.forks(view,config,scene,area,selectedId);this.tokens(view,config,theme,area,time,selectedId);}
    else{this.forks(view,config,scene,null,selectedId);this.rows(view,config,theme,scene,selectedId);}
    this.life(view,time,reducedMotion,config,scene);    // 触须/飞行词/蜘蛛/分箱: 压在词墙之上(同参考演示)
    if(!view.totalEvents)this.emptyHint(wall?area:scene,theme);
    c.restore();
    if(wall)this.editorFade(area,theme,placed,scroll);
    if(layout.stream)this.stream(view,layout.stream,theme);
    this.stats(view,layout.stats,theme);
    if(layout.probes)this.probes(view,layout.probes,theme,config);   // landscape 专属: 参考演示底部四格探针带
    this.text(`${config.unit.toUpperCase()} MODE   /   ${view.status.toUpperCase()}   /   ${view.at.toFixed(2)} s`,40,layout.height-18,theme.muted,10);
    this.text('真实事件 · 由 Agent 主动上报',layout.width-40,layout.height-18,theme.accent,10,'right');
    this.drawInteractionLayer(layout);
  }
  // 微交互覆盖层(与参考渲染器同款): hover 虚线轻框 + 点击扩散圆环。
  // regions 命中区与 hitTest 同源, 坐标零错位; 圆环靠帧时间自然消散(rAF 每帧重绘)。
  drawInteractionLayer(layout){
    const c=this.ctx;
    if(this.hoverId!=null){
      const region=this.regions.find(item=>item.event.id===this.hoverId);
      if(region){
        const cy=region.cy??region.y;
        c.strokeStyle='rgba(255,255,255,.5)';c.lineWidth=1;c.setLineDash([3,3]);
        c.strokeRect(region.x-1.8,cy-region.h/2-1.6,region.w+3.6,region.h+3.2);
        c.setLineDash([]);
      }
    }
    if(this.pulse){
      const age=((globalThis.performance?.now()||0)-this.pulse.t)/1000;
      if(age>.42)this.pulse=null;
      else{
        const p=age/.42;
        c.beginPath();c.arc(this.pulse.x,this.pulse.y,4+p*16,0,Math.PI*2);
        c.strokeStyle=`rgba(242,60,131,${((1-p)*.8).toFixed(3)})`;c.lineWidth=1.6;c.stroke();
      }
    }
  }
  // 客户端坐标 → 本布局坐标(与 hitTest 同一映射), 供点击脉冲定位。
  toCanvas(clientX,clientY){
    const r=this.canvas.getBoundingClientRect();
    if(!this.layout||!r.width||!r.height)return null;
    return {x:(clientX-r.left)/r.width*this.layout.width,y:(clientY-r.top)/r.height*this.layout.height};
  }
  // 词墙垂直滚动: 目标随"最新词所在行"跳变, 用与轨道同一节奏的指数平滑 => 整墙平滑上滚而非跳行。
  easeWallScroll(placed,area,reducedMotion){
    const target=wallScrollTarget(placed,area);
    const now=(globalThis.performance?.now()||0)/1000,dt=now-this.wallScrollTime;this.wallScrollTime=now;
    const snap=!this.wallScrollReady||reducedMotion||!(dt>0)||dt>0.5||Math.abs(target-this.wallScroll)>area.h*.8;
    this.wallScroll=snap?target:easeValue(this.wallScroll,target,dt);
    this.wallScrollReady=true;
    return this.wallScroll;
  }
  // 编辑器外框: 红绿灯 + 文件名 + ln N(随滚动变化的当前行), 与参考演示 studio.prompt 同构。
  editorChrome(area,theme,config,scroll){
    const c=this.ctx;
    c.fillStyle=theme.panel;c.fillRect(area.x,area.y,area.w,area.h);
    c.fillStyle=theme.panelTop;c.fillRect(area.x+1,area.y+1,area.w-2,WALL_HEAD-1);
    c.strokeStyle=theme.border;c.lineWidth=1;c.strokeRect(area.x+.5,area.y+.5,area.w-1,area.h-1);
    TRAFFIC.forEach((color,i)=>{c.fillStyle=color;c.beginPath();c.arc(area.x+15+i*14,area.y+WALL_HEAD*.52,4.2,0,Math.PI*2);c.fill();});
    this.text(config.unit==='word'?'studio.prompt':'agent.tasks',area.x+62,area.y+WALL_HEAD*.62,theme.text,11.5);
    this.text(`ln ${Math.floor(scroll/WALL_ROW)+1}`,area.x+area.w-12,area.y+WALL_HEAD*.62,theme.muted,10,'right');
  }
  // 编辑器内容(裁剪在标题栏之下): 行号槽随整墙一起滚动, 只给有词团的行画行号(同参考演示)。
  // regions 已是滚动后的屏幕坐标, 行号直接对齐词团基线。
  editorGutter(area,theme,regions){
    const c=this.ctx;c.fillStyle=alpha(theme.border,.28);c.fillRect(area.x+44,area.y+WALL_HEAD,1,area.h-WALL_HEAD);
    const rows=new Map();for(const r of regions)if(!rows.has(r.row))rows.set(r.row,r.y);
    for(const [row,y] of rows)this.text(String(row+1).padStart(2,' '),area.x+34,y,theme.muted,9.5,false,'right');
  }
  // 词元矩形框(参考演示同款): 已分流词用分支色画实心或描边框, 新到词短暂粉色高亮, 选中加白框。
  tokens(view,config,theme,area,time,selectedId){
    const c=this.ctx;
    this.editorGutter(area,theme,this.regions);
    for(const region of this.regions){
      const event=region.event,color=config.routes[event.route].color,selected=event.id===selectedId;
      const boxW=Math.min(area.w-52,region.w),x=region.x,y=region.y;
      c.globalAlpha=event.status==='pending'?.4:1;
      if(!event.status||event.status==='pending'){
        this.text(this.label(region.text,boxW-6),x,y,theme.text,TOKEN_SIZE);
      }else if(time-event.firstAt<.18){                   // 刚上报: 粉色整块高亮(参考扫描瞬间)
        c.fillStyle=theme.accent;c.fillRect(x-1.2,y-12.4,boxW+2.4,16.4);
        this.text(this.label(region.text,boxW-6),x,y,'#190a13',TOKEN_SIZE);
      }else if(pseudoRandom(region.index+22)>.29){         // 实心框 + 深色字
        c.fillStyle=color;c.globalAlpha*=.87;c.fillRect(x-1.2,y-12.4,boxW+2.4,16.4);
        c.globalAlpha=event.status==='pending'?.4:1;
        this.text(this.label(region.text,boxW-6),x,y,'#10191a',TOKEN_SIZE);
      }else{                                              // 描边框 + 浅色字
        c.strokeStyle=color;c.lineWidth=.9;c.strokeRect(x-1.3,y-12.4,boxW+2.6,16.4);
        this.text(this.label(region.text,boxW-6),x,y,'#e6e7e5',TOKEN_SIZE);
      }
      if(event.status==='failed'){c.fillStyle=theme.accent;c.fillRect(x+boxW+3,y-8,4,4);}
      c.globalAlpha=1;
      if(selected){c.strokeStyle='#ffffff';c.lineWidth=1.4;c.strokeRect(x-3.2,y-14.6,boxW+5.4,20.6);}
    }
  }
  // 底部渐隐: 词滚出可视区时淡出, 与参考演示编辑列一致。
  editorFade(area,theme,placed,scroll){
    const c=this.ctx,fade=c.createLinearGradient(0,area.y+area.h-34,0,area.y+area.h-2);
    fade.addColorStop(0,alpha(theme.panel,0));fade.addColorStop(1,theme.panel);
    c.fillStyle=fade;c.fillRect(area.x+1,area.y+area.h-34,area.w-2,33);
    const rows=placed.length?placed[placed.length-1].row+1:0,visible=(area.h-WALL_HEAD-8)/WALL_ROW;
    if(rows<=visible)return;                              // 不足一屏: 无滚动条
    const trackH=area.h-WALL_HEAD-10,knob=Math.max(24,trackH*visible/rows);
    const maxScroll=Math.max(1,(rows-visible)*WALL_ROW),progress=Math.min(1,scroll/maxScroll);
    c.fillStyle=alpha(theme.text,.10);c.fillRect(area.x+area.w-5,area.y+WALL_HEAD+5,3,trackH);
    c.fillStyle=alpha(theme.text,.28);c.fillRect(area.x+area.w-5,area.y+WALL_HEAD+5+(trackH-knob)*progress,3,knob);
  }
  mesh(theme){
    const c=this.ctx,s=this.layout.scene;
    for(let i=0;i<24;i++){
      const y=s.y+55+(s.h-85)*i/23,target=routeTarget(this.layout,ROUTES[i%3]);
      c.beginPath();c.moveTo(s.x+s.w*.33,y);c.bezierCurveTo(s.x+s.w*.56,y,s.x+s.w*.65,target.y,target.x,target.y);c.strokeStyle=alpha(theme.spider,.055);c.lineWidth=.65;c.stroke();
    }
  }
  // 每个词一条分流线: 词墙布局从编辑列右缘出发(线不穿过正文), 其余布局从词尾出发。
  forks(view,config,scene,area,selectedId){
    const c=this.ctx;
    for(const region of this.regions){
      const event=region.event,color=config.routes[event.route].color,target=routeTarget(this.layout,event.route);
      const fromX=area?Math.min(region.x+region.w,area.x+area.w):region.x+region.w,y=region.cy??region.y;
      const cp1=area?fromX+(scene.x+scene.w*.52-fromX)*.9:scene.x+scene.w*.52,cp2=area?fromX+(scene.x+scene.w*.66-fromX)*.9:scene.x+scene.w*.66;
      c.beginPath();c.moveTo(fromX,y);c.bezierCurveTo(cp1,y,cp2,target.y,target.x,target.y);c.strokeStyle=alpha(event.id===selectedId?config.theme.accent:color,event.id===selectedId?.9:.22);c.lineWidth=event.id===selectedId?1.4:.7;c.stroke();
    }
  }
  rows(view,config,theme,scene,selectedId){
    const c=this.ctx;
    for(const region of this.regions){
      const {event,x,y,w,h}=region,color=config.routes[event.route].color,selected=event.id===selectedId;
      if(selected||event.status==='running'){c.fillStyle=alpha(selected?theme.accent:color,.13);c.fillRect(x-6,y-h/2,w+8,h);}
      this.text(String(event.order??region.index+1).padStart(3,'0'),x,y+4,theme.muted,9);
      this.text(this.label(event.displayLabel??event.label,w-64),x+35,y+4,color,11);
      c.fillStyle=event.status==='failed'?theme.accent:color;c.globalAlpha=event.status==='pending'?.35:1;c.fillRect(x+w-12,y-3,5,5);c.globalAlpha=1;
    }
  }
  emptyHint(box,theme){
    this.text('等待 Agent 上报第一个事件',box.x+30,box.y+93,theme.text,16);
    this.text('每一次真实步骤，都会在这里结成一张网。',box.x+30,box.y+121,theme.muted,11);
  }
  // 活的层: 探测触须、飞行词元、蜘蛛本体、右缘分箱(全部压在词墙正文之上)。
  life(view,time,reducedMotion,config,scene){
    const c=this.ctx,t=config.theme,s=scene,body=this.easedPose(time,reducedMotion);
    const active=new Map(view.activeEvents.slice(-200).map(event=>[event.id,event]));
    for(const region of this.regions){
      const event=active.get(region.event.id);if(!event)continue;const age=time-event.firstAt;if(age<0||age>3.8)continue;
      const color=config.routes[event.route].color,target=routeTarget(this.layout,event.route),from={x:region.x+region.w/2,y:region.cy??region.y};
      const pose=probePose({index:event.order,word:event.label,target:from,launchTime:event.firstAt+.26},time,body,reducedMotion);
      if(pose.visible){c.globalAlpha=pose.opacity;c.beginPath();c.moveTo(pose.root.x,pose.root.y);c.bezierCurveTo(pose.joints[0].x,pose.joints[0].y,pose.joints[1].x,pose.joints[1].y,pose.tip.x,pose.tip.y);c.setLineDash([1.8,4]);c.strokeStyle=t.spider;c.lineWidth=1.2;c.stroke();c.setLineDash([]);c.globalAlpha=1;}
      if(age>=.52){const p=reducedMotion?1:Math.min(1,(age-.52)/1.2),q=1-p;const x=q*q*from.x+2*q*p*(s.x+s.w*.65)+p*p*target.x,y=q*q*from.y+2*q*p*from.y+p*p*target.y;c.fillStyle=color;c.fillRect(x-3,y-3,6,6);if(p<1)this.text(this.label(event.label,120),x+7,y+4,color,10);}
    }
    this.spider(body,time,reducedMotion,t);
    for(const route of ROUTES){const p=routeTarget(this.layout,route),color=config.routes[route].color,w=s.w*.19,h=100;c.fillStyle=t.panel;c.fillRect(p.x-w/2,p.y-h/2,w,h);c.strokeStyle=alpha(color,.8);c.strokeRect(p.x-w/2,p.y-h/2,w,h);c.fillStyle=color;c.fillRect(p.x-w/2,p.y-h/2,w,5);this.text(config.routes[route].label,p.x-w/2+12,p.y-20,color,12);this.text(view.counts[route]??0,p.x+w/2-12,p.y+18,color,29,'right',true);this.text(route.toUpperCase(),p.x-w/2+12,p.y+37,t.muted,9);}
  }
  // 蜘蛛位姿 = 沿"缓动后的轨道"取当前角度。目标轨道参数(词团 bbox/翻页/过滤/滚动)突变时参数指数逼近,
  // 位置保持连续; snap 场景(首帧/reducedMotion/后台恢复/大幅 seek)直接落位。
  easedPose(time,reducedMotion) {
    const s=this.layout.scene,target=orbitTarget(this.layout,this.wallTight??null);
    const now=(globalThis.performance?.now()||0)/1000,dt=now-this.orbitTime;this.orbitTime=now;
    const diag=Math.hypot(s.w,s.h)*.6;
    const snap=!this.orbit||reducedMotion||!(dt>0)||dt>0.5||Math.hypot(target.cx-this.orbit.cx,target.cy-this.orbit.cy)>diag;
    this.orbit=snap?target:easeOrbit(this.orbit,target,dt);
    this.orbitDt=snap?0:dt;   // snap 帧位置瞬移, 帧间差分不可信, 记 0 供 spider() 回落解析速度
    return poseFromOrbit(this.orbit,time,reducedMotion?0:Math.PI*2/16,reducedMotion);
  }
  spider(body,time,reducedMotion,theme){
    const c=this.ctx,now=(globalThis.performance?.now()||0)/1000;
    // 差分速率 |Δpos|/Δt 与解析速度(r×ω, px/s)同量纲, 直接可比; snap 帧(orbitDt=0)或步长异常时差分不可信, 回落解析速度。
    const speed=this.orbitPos&&this.orbitDt>0&&this.orbitDt<=.5?Math.hypot(body.x-this.orbitPos.x,body.y-this.orbitPos.y)/this.orbitDt:Math.hypot(body.vx,body.vy);
    this.orbitPos={x:body.x,y:body.y,t:now};
    c.save();c.translate(body.x,body.y);c.rotate(Math.atan2(body.vx,-body.vy)||0);
    for(const side of [-1,1])for(let index=0;index<8;index++){const pose=legPose({time,reducedMotion,side,index,speed});c.beginPath();c.moveTo(pose.root.x,pose.root.y);for(const p of [pose.knee,pose.ankle,pose.foot])c.lineTo(p.x,p.y);c.strokeStyle=alpha(theme.spider,.76);c.lineWidth=1;c.stroke();c.fillStyle=theme.spider;c.fillRect(pose.foot.x-1,pose.foot.y-1,2,2);}
    c.fillStyle=alpha(theme.spider,.10);c.strokeStyle=theme.spider;c.beginPath();c.ellipse(0,0,24,30,0,0,Math.PI*2);c.fill();c.stroke();
    c.save();c.clip();for(let i=-3;i<=3;i++){c.strokeStyle=alpha(theme.spider,.32);c.beginPath();c.ellipse(i*5,0,8,30,0,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(0,i*7,24,7,0,0,Math.PI*2);c.stroke();}c.restore();
    const heart=heartbeatAt(time,reducedMotion);c.shadowColor=theme.accent;c.shadowBlur=heart.glow;c.fillStyle=theme.accent;c.fillRect(-heart.size/2,-heart.size/2,heart.size,heart.size);c.shadowBlur=0;c.restore();
  }
  // landscape 四格探针带(参考演示底排同款): 分数轨迹 / 事件点阵 / 覆盖率球 / 分支账本。
  // 数据全部来自 view 现成字段; 分数未上报只标注、不虚构; 点阵与分数点注册进 regions, 可点可 hover。
  probes(view,boxes,t,config){
    const c=this.ctx,[scoreBox,dotsBox,sphereBox,routeBox]=boxes;
    // ① 分数轨迹(参考 confidence · last 40): 折线 + 分支色点 + avg。
    this.panel(scoreBox,'SCORE · THIS PAGE',t,'ONE POINT = ONE EVENT');
    const scored=view.events.filter(e=>typeof e.score==='number');
    const gx=scoreBox.x+14,gy=scoreBox.y+48,gw=scoreBox.w-28,gh=66;
    for(let i=0;i<=3;i++)this.line(gx,gy+gh*i/3,gx+gw,gy+gh*i/3,t.border,.6);
    if(scored.length){
      const pts=scored.map((e,i)=>({x:gx+(scored.length===1?gw/2:i/(scored.length-1)*gw),y:gy+(1-Math.max(0,Math.min(1,e.score)))*gh,e}));
      c.beginPath();pts.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.strokeStyle=t.accent;c.lineWidth=1.2;c.stroke();
      for(const p of pts){c.fillStyle=config.routes[p.e.route].color;c.fillRect(p.x-1.8,p.y-1.8,3.6,3.6);
        this.regions.push({event:p.e,x:p.x-6,y:p.y,w:12,h:14});}   // hitEvent 语义: y=中心, 非顶边
      this.text(`avg ${(scored.reduce((s,e)=>s+e.score,0)/scored.length).toFixed(3)} · ${scored.length} scored`,gx,scoreBox.y+scoreBox.h-14,t.text,10.5,'left',true);
    }else this.text('分数未上报 · 不猜测',gx,gy+gh/2,t.muted,11);
    // ② 事件点阵(参考 words read): 一页最多 32 事件, 三行铺开, pending 淡色、failed 用品红。
    this.panel(dotsBox,'EVENT DOTS',t,'CLICK DOT TO INSPECT');
    const cols=15,sx=dotsBox.x+16,sy=dotsBox.y+54,stepX=(dotsBox.w-32)/(cols-1);
    view.events.forEach((e,i)=>{
      const x=sx+i%cols*stepX,y=sy+Math.floor(i/cols)*17,pending=e.status==='pending';
      c.globalAlpha=pending?.35:1;c.fillStyle=e.status==='failed'?t.accent:config.routes[e.route].color;
      c.beginPath();c.arc(x,y,pending?2.4:3.4,0,Math.PI*2);c.fill();c.globalAlpha=1;
      this.regions.push({event:e,x:x-6,y,w:12,h:14});});   // hitEvent 语义: y=中心
    this.text(`${view.events.length} / ${view.totalEvents} events`,sx,dotsBox.y+dotsBox.h-14,t.text,10.5,'left',true);
    // ③ 覆盖率球(参考 prompt coverage 3d): 完成事件占全部上报之比, 同款球旋转。
    this.panel(sphereBox,'COMPLETION COVERAGE',t,'3d');
    const cx=sphereBox.x+sphereBox.w/2,cy=sphereBox.y+sphereBox.h/2+6,radius=Math.min(sphereBox.w,sphereBox.h)*.29;
    const coverage=view.totalEvents?Math.min(1,(view.statusCounts.completed||0)/view.totalEvents):0;
    const spin=(Number.isFinite(view.at)?view.at:0)*.085,points=[];
    for(let i=0;i<320;i++){const yy=1-(i+.5)/320*2,ring=Math.sqrt(1-yy*yy),a=i*Math.PI*(3-Math.sqrt(5));
      const xx=Math.cos(a)*ring,zz=Math.sin(a)*ring;
      const x=xx*Math.cos(spin)+zz*Math.sin(spin),z=-xx*Math.sin(spin)+zz*Math.cos(spin);
      points.push({x,y:yy*.96-z*.27,z:yy*.27+z*.96,i});}
    points.sort((a,b)=>a.z-b.z);
    for(const p of points){const perspective=1+p.z*.11,x=cx+p.x*radius*perspective,y=cy+p.y*radius*perspective;
      const covered=pseudoRandom(p.i+100)<coverage;
      c.globalAlpha=(.25+(p.z+1)*.37)*(covered?1:.5);
      c.fillStyle=covered?t.accent:t.muted;
      const size=p.z>.5?2.4:1.8;c.fillRect(x-size/2,y-size/2,size,size*.65);}
    c.globalAlpha=1;
    this.text(`${Math.round(coverage*100)}% completed · ${view.statusCounts.completed||0}/${view.totalEvents}`,sphereBox.x+14,sphereBox.y+sphereBox.h-14,t.text,10.5,'left',true);
    // ④ 分支账本(参考 who had to think): 每条分支计数 + 占比条。
    this.panel(routeBox,'ROUTED BY BRANCH',t);
    ROUTES.forEach((route,i)=>{const y=routeBox.y+58+i*27,color=config.routes[route].color;
      c.fillStyle=color;c.fillRect(routeBox.x+14,y-9,4,15);
      this.text(this.label(config.routes[route].label,130),routeBox.x+26,y,t.text,11);
      this.text(view.counts[route]??0,routeBox.x+routeBox.w-14,y,color,12,'right',true);
      cFill(c,routeBox.x+26,y+5,Math.max(1,(routeBox.w-54)*(view.counts[route]??0)/Math.max(1,view.totalEvents)),3,color);});
    this.text('分支由 Agent 上报决定 · 未上报不猜测',routeBox.x+14,routeBox.y+routeBox.h-14,t.muted,10);
  }
  stream(view,rect,t){this.panel(rect,'RECENT / EVENT DETAILS',t,'CLICK TASK TO INSPECT');const rows=view.events.slice(-Math.floor((rect.h-45)/29));for(let i=0;i<rows.length;i++){const e=rows[i],y=rect.y+55+i*29,color=view.config.routes[e.route].color;this.text(this.label(e.label,rect.w*.52),rect.x+13,y,t.text,11);this.text(STATUS[e.status],rect.x+rect.w*.60,y,color,10);this.text(e.score===null||e.score===undefined?'分数未提供':Number(e.score).toFixed(3),rect.x+rect.w-13,y,t.muted,10,'right');}}
  stats(view,rect,t){
    this.panel(rect,'SESSION / REPORTED METRICS',t);const compact=rect.h<180;
    if(compact){const items=[['已上报',view.totalEvents],['完成',view.statusCounts.completed??0],['失败',view.statusCounts.failed??0],['预计总量',view.config.expectedTotal??'未提供'],['模型调用','未提供']];items.forEach(([label,value],i)=>{const x=rect.x+20+i*(rect.w-40)/items.length;this.text(label,x,rect.y+64,t.muted,11);this.text(value,x,rect.y+100,i===0?t.accent:t.text,22);});return;}
    this.text(view.totalEvents,rect.x+20,rect.y+83,t.accent,43,'left',true);this.text('真实上报事件',rect.x+20,rect.y+106,t.muted,11);
    let y=rect.y+141;for(const route of ROUTES){const color=view.config.routes[route].color,label=view.config.routes[route].label;this.text(this.label(label,100),rect.x+20,y,color,11);cFill(this.ctx,rect.x+125,y-8,Math.max(1,(rect.w-175)*(view.counts[route]??0)/Math.max(1,view.totalEvents)),5,color);this.text(view.counts[route]??0,rect.x+rect.w-15,y,color,11,'right');y+=28;}
    this.text(`预计总量 ${view.config.expectedTotal??'未提供'}`,rect.x+20,y+9,t.muted,11);this.text('模型调用 未提供',rect.x+20,y+32,t.muted,11);
  }
}
function cFill(ctx,x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}
