import stripAnsi from 'strip-ansi';
import { countFullClears, countEraseLineUps } from './ansi-metrics.js';

/** 把 frames[] 汇总为结构化闪烁度量。durationMs 用于计算 fps。 */
export function measureFrames(frames, { durationMs = 0 } = {}) {
  const joined = frames.join('');
  return {
    frameCount: frames.length,
    fps: durationMs > 0 ? frames.length / (durationMs / 1000) : frames.length,
    bytesTotal: joined.length,
    fullClearCount: countFullClears(joined),
    eraseLinesTotal: countEraseLineUps(joined),
    layoutShifts: countLayoutShifts(frames),
  };
}

/** 帧的可见内容行（剥掉 ANSI 序列；擦除序列同为 CSI 会被剥除）。 */
export function visibleLines(frame) {
  return stripAnsi(frame).split('\n');
}

/** 帧总行数变化次数（布局跳动代理指标）。 */
export function countLayoutShifts(frames) {
  let shifts = 0;
  let prev = null;
  for (const f of frames) {
    const h = visibleLines(f).length;
    if (prev !== null && h !== prev) shifts++;
    prev = h;
  }
  return shifts;
}

/**
 * 稳定区违规：lineSelector 选中的行（如已完成消息）在相邻帧间内容变化的次数。
 * 正常应为 0 —— 历史消息行不应被后续渲染改动。
 */
export function stableLineViolations(frames, lineSelector) {
  let violations = 0;
  let prev = null;
  for (const f of frames) {
    const selected = visibleLines(f).filter(lineSelector).join('\n');
    if (prev !== null && selected !== prev) violations++;
    prev = selected;
  }
  return violations;
}

/** 相邻帧逐行 diff：每帧相对上一帧的变化行数（首帧为总行数）。 */
export function perFrameDiffLines(frames) {
  const diffs = [];
  let prevLines = null;
  for (const f of frames) {
    const lines = visibleLines(f);
    if (prevLines === null) {
      diffs.push(lines.length);
    } else {
      let d = Math.abs(lines.length - prevLines.length);
      const n = Math.min(lines.length, prevLines.length);
      for (let i = 0; i < n; i++) if (lines[i] !== prevLines[i]) d++;
      diffs.push(d);
    }
    prevLines = lines;
  }
  return diffs;
}
