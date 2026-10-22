import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRun, sessionStateAt, segmentWords, REFERENCE_LOOP } from '../app/reference-session.js';

const config = {
  unit: 'task', prompt: '', layout: 'wall',
  routes: {
    code: { label: '项目层命中', color: '#42d6a4' },
    model: { label: '通用层命中', color: '#f28a76' },
    ext: { label: '外接源命中', color: '#f34a87' },
    you: { label: '已读消费', color: '#f0ca57' },
  },
};
const events = Array.from({ length: 12 }, (_, i) => ({
  id: `e${i}`, label: `解析 查询 参数 ${i}`, route: ['code', 'model', 'ext', 'you'][i % 4],
  status: 'completed', score: null, detail: '', tokenIndex: null, occurredAt: null,
  order: i, firstAt: i * 0.5, updatedAt: i * 0.5 + 0.05,
}));

test('segmentWords splits Chinese labels into word-level pieces', () => {
  const words = segmentWords('解析 kb search 查询参数');
  assert.ok(words.length >= 4);
  assert.ok(words.every(word => /\S/u.test(word)));
  assert.deepEqual(segmentWords('   '), []);
});

test('session run lays out one token per word and keeps event identity for clicks', () => {
  const run = sessionRun({ config, events });
  assert.equal(run.mode, 'session');
  assert.equal(run.decisions.length, 12);                          // decision 仍以事件为单位
  assert.equal(run.sourceLines.length, 12);                        // 每事件一行
  assert.ok(run.tokens.length > 12);                               // 词级铺排: 词数 > 事件数
  assert.equal(run.tokens.length, Object.keys(run.wordRoutes).length);   // 每个词都有路由着色(满屏词框)
  assert.ok(run.tokens.every(token => run.sourceLines[token.line].includes(token.word)));   // 词都落在所属行内
  assert.deepEqual(run.routes, ['code', 'model', 'ext', 'you']);
  assert.equal(run.routeColors.ext, '#f34a87');
  assert.equal(run.routeLabels.code, '项目层命中');
  assert.equal(run.decisions[3].route, 'you');
  assert.ok(run.decisions.every(d => d.index != null && run.wordRoutes[d.index] === d.route));   // 锚点词与事件同路由
  assert.equal(run.hasScores, false);                              // 未上报分数如实标记
  assert.ok(run.decisions.every(d => d.demoScore));
  assert.equal(run.indexToEventId[run.eventIdToIndex.e5], 'e5');   // 点击命中词 → 反查事件可往返
});

test('session state projects the timeline faithfully and loops the spider pose', () => {
  const run = sessionRun({ config, events });
  const midway = sessionStateAt(run, 3.2);
  assert.equal(midway.counts.code + midway.counts.model + midway.counts.ext + midway.counts.you, midway.decisions.length);
  assert.ok(midway.decisions.length > 0 && midway.decisions.length < 12);
  assert.equal(midway.read, midway.scanned.length);
  assert.ok(midway.gridEvents.length === 12);                      // 圆点栅格: 一个点 = 一个事件
  assert.ok(midway.poseTime >= 0 && midway.poseTime < REFERENCE_LOOP);
  const end = sessionStateAt(run, run.duration + 999);
  assert.equal(end.decisions.length, 12);
});

test('running events keep their word boxes visible from first report (no backward jump on completion)', () => {
  const runningEvents = [
    { id: 'r0', label: '读取 配置 完成', route: 'code', status: 'running', score: null, detail: '', tokenIndex: null, firstAt: 1, updatedAt: 6 },
  ];
  const run = sessionRun({ config, events: runningEvents });
  const anchor = run.eventIdToIndex.r0;
  assert.equal(run.wordArrivals[anchor], 1);                       // 词框出现时间 = 首次上报
  assert.equal(run.decisions[0].time, 6);                          // decision 完成时刻仍取 updatedAt
  const midway = sessionStateAt(run, 2);
  assert.ok(midway.wordArrivals[anchor] <= midway.elapsed);        // t=2 回看: 词框已在场
  assert.equal(midway.decisions.length, 0);                        // 但尚未完成, 不计入决策流
  assert.ok(Object.keys(run.wordArrivals).every(index => run.wordRoutes[index] !== undefined));
});

test('word-unit sessions keep prompt words in the editor and map tokenIndex back to events', () => {
  const wordConfig = { ...config, unit: 'word', prompt: '解析 查询 参数\n重建 索引' };
  const wordEvents = [
    { id: 'w0', label: 'fallback', route: 'code', status: 'completed', score: 0.9, detail: '', tokenIndex: 0, firstAt: 0, updatedAt: 0.1 },
    { id: 'w3', label: 'fallback', route: 'you', status: 'completed', score: 0.4, detail: '', tokenIndex: 3, firstAt: 0.5, updatedAt: 0.6 },
  ];
  const run = sessionRun({ config: wordConfig, events: wordEvents });
  assert.equal(run.sourceLines.length, 2);                          // 原文两行
  assert.equal(run.tokens.length, 5);                               // 原文共 5 个词
  assert.equal(run.decisions[1].index, 3);                          // tokenIndex=3 → 第二行首词
  assert.equal(run.tokens[3].word, '重建');
  assert.equal(run.hasScores, true);
  assert.equal(run.decisions[1].demoScore, false);                  // 真实上报的分数不算演示值
  assert.equal(run.eventIdToIndex.w3, 3);
});
