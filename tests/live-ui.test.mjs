import test from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_LAYOUTS, livePose, eventPlacement, hitEvent, resolveCursor, parseSseFrames, orbitTarget, poseFromOrbit, easeOrbit } from '../app/live-layout.js';

test('live layouts keep the scene, details and hit regions inside each stage', () => {
  assert.deepEqual(Object.values(LIVE_LAYOUTS).map(x => [x.width, x.height]), [[1080, 1350], [1600, 900], [1080, 1080], [1600, 900]]);
  for (const layout of Object.values(LIVE_LAYOUTS)) {
    for (const box of [layout.scene, layout.stats, layout.stream].filter(Boolean)) {
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.w <= layout.width && box.y + box.h <= layout.height);
    }
    const event = { id: 'step-1', order: 1, label: 'Read source', route: 'code' };
    const placed = eventPlacement(layout, [event]);
    assert.equal(hitEvent(placed, placed[0].x + 3, placed[0].y), event.id);
    assert.equal(hitEvent(placed, 0, 0), null);
  }
});

test('live spider movement is continuous across loops and long sessions', () => {
  const layout = LIVE_LAYOUTS.portrait;
  for (const time of [0, 16, 32, 100000]) {
    const before = livePose(layout, time - 0.001), after = livePose(layout, time + 0.001);
    assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1);
    assert.ok(Number.isFinite(after.vx + after.vy));
  }
  assert.deepEqual(livePose(layout, 1, true), livePose(layout, 2000, true));
});

test('cursor follows server anchor without resetting live data on animation loops', () => {
  const record = { elapsed: 9000, duration: 9000, status: 'live', playback: {mode:'live',position:9000,speed:1,loop:false} };
  assert.equal(resolveCursor(record, 1200), 9001.2);
  record.playback.mode='paused'; assert.equal(resolveCursor(record,1200),9000);
  record.status='completed'; record.duration=10; record.playback={mode:'playing',position:9,speed:2,loop:true};
  assert.equal(resolveCursor(record, 1000), 1);
  record.status='live';record.source='replay';record.playback.loop=false;
  assert.equal(resolveCursor(record, 10000),10,'an imported live snapshot has no producer or growing duration');
});

test('authenticated SSE parser retains fragmented frames and ignores comments', () => {
  let partial = parseSseFrames(': keepalive\n\ndata: {"type":"up');
  assert.equal(partial.messages.length,0);
  const frames=parseSseFrames(partial.rest+'date"}\r\n\r\ndata: {"type":"control"}\n\n');
  assert.deepEqual(frames.messages,[{type:'update'},{type:'control'}]);
  assert.equal(frames.rest,'');
});

test('poseFromOrbit(orbitTarget(...)) equals livePose (pure refactor)', () => {
  const wall = LIVE_LAYOUTS.wall, tight = { x: 300, y: 250, w: 420, h: 130 };
  for (const [layout, t] of [[wall, 0], [wall, 3.7], [LIVE_LAYOUTS.portrait, 9.2]]) {
    for (const tightArg of (layout === wall ? [tight, null] : [null])) {
      const omega = Math.PI * 2 / 16;
      assert.deepEqual(poseFromOrbit(orbitTarget(layout, tightArg), t, omega), livePose(layout, t, false, tightArg));
    }
  }
  assert.deepEqual(poseFromOrbit(orbitTarget(wall, tight), 5, 0, true), livePose(wall, 5, true, tight));
});

test('easeOrbit approaches target monotonically without overshoot', () => {
  const from = { cx: 700, cy: 400, rx: 300, ry: 250 }, to = { cx: 500, cy: 300, rx: 210, ry: 60 };
  let cur = from, prev = Infinity;
  for (let i = 0; i < 60; i++) {
    cur = easeOrbit(cur, to, 1 / 60);
    const d = Math.hypot(cur.cx - to.cx, cur.cy - to.cy);
    assert.ok(d < prev); prev = d;                       // 单调逼近
  }
  assert.ok(Math.hypot(cur.cx - to.cx, cur.cy - to.cy) < 13); // 1s 后基本收敛: 残差=初距·e^(-1/0.35)≈5.7%
  const half = easeOrbit(from, to, 0.25);                     // k=1-e^(-0.25/0.35)≈0.51: 单帧不过跳
  assert.ok(Math.hypot(half.cx - from.cx, half.cy - from.cy) < 0.6 * Math.hypot(to.cx - from.cx, to.cy - from.cy));
  const frame = easeOrbit(from, to, 1 / 60);
  assert.ok(Math.hypot(frame.cx - from.cx, frame.cy - from.cy) < 0.1 * Math.hypot(to.cx - from.cx, to.cy - from.cy));
  assert.deepEqual(easeOrbit(from, to, 30), to);              // dt→∞ 精确落位
  const still = easeOrbit(to, to, 0.5);
  assert.deepEqual({ x: still.cx, y: still.cy }, { x: to.cx, y: to.cy }); // 目标不动则不动
});
