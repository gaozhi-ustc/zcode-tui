import { test, expect } from 'vitest';
import { measureFrames, stableLineViolations, perFrameDiffLines, countLayoutShifts } from './frame-metrics.js';

test('measureFrames 汇总度量', () => {
  const frames = ['abc', '\x1b[2K\x1b[1A\x1b[2Kabc', '\x1b[2J\x1b[3J\x1b[Habc'];
  const m = measureFrames(frames, { durationMs: 1000 });
  expect(m.frameCount).toBe(3);
  expect(m.fps).toBe(3);
  expect(m.fullClearCount).toBe(1);
  expect(m.eraseLinesTotal).toBe(1);
  expect(m.bytesTotal).toBeGreaterThan(0);
});

test('stableLineViolations 检测应稳定行的变化', () => {
  const stable = ['头\n稳定行MARKER\n尾1', '头\n稳定行MARKER\n尾2'];
  expect(stableLineViolations(stable, l => l.includes('MARKER'))).toBe(0);
  const changed = ['头\n稳定行MARKER\n尾', '头\n稳定行MARKER被改\n尾'];
  expect(stableLineViolations(changed, l => l.includes('MARKER'))).toBe(1);
});

test('stableLineViolations 跳过选中为空的增量部分帧', () => {
  // 增量渲染：帧1含稳定行，帧2是部分帧（不含），帧3重写该行但内容相同 → 0 违规
  const frames = ['头\n稳定行MARKER\n尾', '其他行', '头\n稳定行MARKER\n尾'];
  expect(stableLineViolations(frames, l => l.includes('MARKER'))).toBe(0);
  // 帧3重写该行且内容改变 → 1 违规
  const changed = ['头\n稳定行MARKER\n尾', '其他行', '头\n稳定行MARKER被改\n尾'];
  expect(stableLineViolations(changed, l => l.includes('MARKER'))).toBe(1);
});

test('perFrameDiffLines 计算相邻帧变化行数', () => {
  expect(perFrameDiffLines(['a\nb', 'a\nc'])).toEqual([2, 1]);
});

test('countLayoutShifts 统计帧行数变化', () => {
  expect(countLayoutShifts(['a\nb', 'a\nb', 'a\nb\nc'])).toBe(1);
});
