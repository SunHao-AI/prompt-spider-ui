import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../app/renderer.js';
import { sessionRun } from '../app/reference-session.js';

// 假 canvas: 7px/字符的定宽度量, 足以驱动 makeLayout 的词流排版与硬拆分支。
const fakeCanvas = () => ({ width: 0, height: 0, addEventListener() {}, removeEventListener() {}, getContext: () => ({ font: '', textAlign: 'left', measureText: text => ({ width: String(text).length * 7 }), setTransform() {} }) });

const config = { unit: 'task', prompt: '', layout: 'wall', routes: { code: { label: 'c', color: '#42d6a4' }, model: { label: 'm', color: '#f28a76' }, ext: { label: 'e', color: '#f34a87' }, you: { label: 'y', color: '#f0ca57' } } };

test('over-long unbreakable words hard-split into column-width segments without overflow', () => {
  const renderer = new Renderer(fakeCanvas(), {});
  const longWord = 'A'.repeat(180);                                  // 180 字符 ≈ 1260px, 远超 281px 列宽
  const run = sessionRun({ config, events: [
    { id: 'a', label: `超长 ${longWord}`, route: 'code', status: 'completed', score: null, detail: '', firstAt: 0, updatedAt: 0.1 },
    { id: 'b', label: '普通 短词', route: 'you', status: 'completed', score: null, detail: '', firstAt: 0, updatedAt: 0.1 },
  ] });
  const layout = renderer.makeLayout(run);
  const segments = [layout.placements[0], ...layout.continuations].filter(p => p && p.word.startsWith('AAAA'));
  assert.ok(segments.length >= 4, `期望超长词拆成多段, 实得 ${segments.length}`);
  for (const segment of segments) {
    assert.ok(segment.x + segment.w <= 69 + 281 + 8, `段仍溢出: right=${segment.x + segment.w}`);
    assert.equal(segment.index, segments[0].index);                  // 各段共享同一 token index(点击任一段命中同一事件)
  }
  // 同行矩形求交: 拆分后依旧零重叠(含片段)。
  const rows = new Map();
  for (const p of [...layout.placements, ...layout.continuations]) { if (!p) continue; if (!rows.has(p.row)) rows.set(p.row, []); rows.get(p.row).push(p); }
  for (const items of rows.values()) {
    items.sort((a, b) => a.x - b.x);
    for (let i = 1; i < items.length; i++) assert.ok(items[i].x >= items[i - 1].x + items[i - 1].w, `行 ${items[i].row} 重叠`);
  }
});
