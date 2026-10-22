// 会话 → 参考演示 state 适配器: 把真实上报的 events 铺成参考演示(preview.gif 同款)的完整设计
// —— 终端词框 / 蛛网扫描槽 / 分流卡 / decision stream / 覆盖率球 / who-had-to-think。
// 时间轴仍由回放游标驱动; 未上报的指标(分数等)如实显示"未提供", 不臆造成 calibrated 概率。
import { tokenizePrompt } from '../lib/config.js';   // 浏览器解析为 /lib/config.js, node 测试可直接相对导入
import { routeSlot } from './motion.js';

const MAX_DOC_EVENTS = 600;              // 文档/圆点栅格的可视上限(超出部分仅计入统计, 不铺词)
export const REFERENCE_LOOP = 20.921;    // 参考蛛轨循环周期(会话时长任意, 姿态按此周期巡游)
const QUESTION_HINTS = ['relevant to task?', 'claim sourced?', 'is this specific?', 'needs approval?'];
// 仅为蛛网/置信曲线的节奏合成 [0,1) 伪值, 渲染层以 demoScore 标记为"未上报", 不当作真实分数。
const rhythmScore = seed => { const v = Math.sin(seed * 269.5 + 183.3) * 43758.5453123; return Math.round((0.5 + 0.5 * (v - Math.floor(v))) * 1000) / 1000; };
const NOTE_BY_ROUTE = { code: '直接命中', model: '模型决策', ext: '外接来源', you: '人工确认' };

// 中文按词切分(同 customRun 的做法): 词间以空格连接后, 渲染层按实测宽度在空格处换行,
// 每个词框都落在词边界上、占独立空间, 不会再出现整条标签跨块导致的重叠。
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
export function segmentWords(value) {
  const spaced = String(value).trim();
  if (!spaced) return [];
  if (segmenter) return [...segmenter.segment(spaced)].map(part => part.segment).filter(word => /\S/u.test(word));
  return spaced.split(/\s+/u).filter(Boolean);
}

/**
 * events(word 单位=提示词逐词, task 单位=每条标签再逐词)→ 参考演示 run。
 * 词级铺排 + 按实测宽度换行, 保证每个词框占独立空间、彼此不重叠; 词框按所属事件的路由着色
 * (wordRoutes), 事件级 decision(分叉/计数/decision stream)忠于真实上报。
 */
export function sessionRun({ config, events, status = 'completed' }) {
  const routed = events.slice(0, MAX_DOC_EVENTS);
  const wordMode = config.unit === 'word' && String(config.prompt || '').trim();
  let sourceLines, eventOf;
  if (wordMode) {
    sourceLines = tokenizePrompt(config.prompt).sourceLines;
    eventOf = new Map(routed.map(event => [event.tokenIndex, event]));
  } else {
    const lines = [];
    eventOf = new Map();
    let next = 0;
    for (const event of routed) {
      const words = segmentWords(String(event.displayLabel ?? event.label ?? event.id));
      lines.push(words.join(' '));
      for (let k = 0; k < words.length; k++) eventOf.set(next + k, event);
      next += words.length;
    }
    sourceLines = lines;
  }
  const tokens = tokenizePrompt(sourceLines.join('\n')).tokens;

  const routes = Object.keys(config.routes);
  const hasScores = routed.some(event => event.score !== null && event.score !== undefined);
  const firstIndexByEvent = new Map();                 // 事件 → 词墙里它的第一个词(decision 的锚点词框)
  eventOf.forEach((event, index) => { if (!firstIndexByEvent.has(event)) firstIndexByEvent.set(event, index); });
  // 每个词框都按所属事件的路由着色(参考图观感: 满屏词框), 新词粉色高亮/计数仍只跟事件 decision 走。
  const wordRoutes = Object.fromEntries([...eventOf.entries()].map(([index, event]) => [index, event.route]));
  // 词框出现时间只认 firstAt(首次上报): running 事件完成后 updatedAt 会变大, 若用 updatedAt
  // 回看时词框会在 firstAt~updatedAt 区间凭空消失。decision 的 time 仍用 updatedAt(表示完成时刻)。
  const wordArrivals = Object.fromEntries([...eventOf.entries()].map(([index, event]) => [index, Math.max(0, Number(event.firstAt) || 0)]));
  const wordFailed = Object.fromEntries([...eventOf.entries()].filter(([, event]) => event.status === 'failed').map(([index]) => [index, true]));

  const decisions = routed.map((event, position) => {
    const index = firstIndexByEvent.get(event) ?? null;
    const launchTime = Math.max(0, Number(event.firstAt) || 0);
    const arrival = Math.max(Number(event.updatedAt) || 0, launchTime + 0.01);
    const reported = event.score !== null && event.score !== undefined;
    return {
      index, ordinal: position, slot: routeSlot(position, Math.max(1, routed.length)),
      word: String(event.displayLabel ?? event.label ?? event.id),
      question: QUESTION_HINTS[position % QUESTION_HINTS.length],
      score: reported ? event.score : rhythmScore(position), demoScore: !reported,
      route: event.route, time: arrival, launchTime, flightDuration: 1.08,
    };
  });
  // words read 圆点栅格: 一个点 = 一个事件(与 header/统计口径一致), 按事件序着色与点亮。
  const gridEvents = decisions.map(item => ({ route: item.route, launchTime: item.launchTime, time: item.time, index: item.index }));

  return {
    mode: 'session', status, sourceLines, tokens, decisions, wordRoutes, wordArrivals, wordFailed, gridEvents,
    total: Math.max(routed.length, events.length), gridTotal: routed.length, routeTotal: routed.length, routes,
    routeColors: Object.fromEntries(routes.map(route => [route, config.routes[route].color])),
    routeLabels: Object.fromEntries(routes.map(route => [route, config.routes[route].label])),
    routeGates: routes.map(route => config.routes[route].label),
    routeNotes: routes.map(route => NOTE_BY_ROUTE[route] ?? route),
    routeTagline: ['每个词框一次分叉', '由 Agent 真实上报驱动'],
    hasScores,
    indexToEventId: Object.fromEntries([...eventOf.entries()].map(([index, event]) => [index, event.id])),
    eventIdToIndex: Object.fromEntries(routed.map(event => [event.id, firstIndexByEvent.get(event)]).filter(([, index]) => index != null)),
    duration: Math.max(0.01, ...decisions.map(item => Math.max(item.time, item.launchTime + item.flightDuration))),
  };
}

/** 与 model.js stateAt 同构: 渲染层只需按 elapsed 过滤, 不感知数据来源。 */
export function sessionStateAt(run, elapsed, extras = {}) {
  const time = Math.max(0, Math.min(elapsed, run.duration));
  const decisions = run.decisions.filter(item => item.time <= time);
  const scanned = run.decisions.filter(item => item.launchTime <= time);
  const flights = run.decisions.filter(item => item.launchTime <= time && item.launchTime + item.flightDuration > time);
  const probeEvents = run.decisions.filter(item => item.launchTime - 0.26 <= time && item.launchTime + 0.52 >= time).filter(item => item.index != null);
  const counts = Object.fromEntries(run.routes.map(route => [route, 0]));
  for (const item of decisions) counts[item.route]++;
  return {
    ...run, elapsed: time, decisions, scanned, flights, probeEvents, counts, read: scanned.length,
    threshold: .95, poseTime: time % REFERENCE_LOOP, routeFilter: 'all', selectedIndex: null, reducedMotion: false,
    ...extras,
  };
}
