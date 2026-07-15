import React, { useState, useEffect, useRef, memo } from 'react';
import { Box, Text } from 'ink';

// === 常量（对齐 Claude Code SpinnerAnimationRow）===

// 旋转字符帧（getDefaultCharacters）
const SPINNER_CHARS = ['·', '✢', '✳', '✶', '✻', '✽'];
// 往返动画：正序 + 逆序去首尾，形成无缝循环
const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse().slice(1, -1)];

// 动画间隔（Claude Code: frame 120ms 算，glimmer 200ms，整体 useAnimationFrame 50ms 驱动）
const TICK_MS = 50;
const FRAME_DIVISOR = 120; // frame = floor(time / 120)

// 30 秒后才显示耗时和 token（SHOW_TOKENS_AFTER_MS）
const SHOW_TOKENS_AFTER_MS = 30000;

// stalled：3 秒无新 token 开始变红，2 秒线性到全红
const STALL_THRESHOLD_MS = 3000;
const STALL_RAMP_MS = 2000;

// 精选动词（从 Claude Code SPINNER_VERBS 选高频的）
const VERBS = [
  'Thinking', 'Processing', 'Analyzing', 'Computing', 'Pondering',
  'Reasoning', 'Reflecting', 'Working', 'Generating', 'Crafting',
  'Synthesizing', 'Contemplating', 'Ruminating', 'Bootstrapping', 'Cooking',
];

/**
 * 格式化耗时（对齐 Claude Code formatDuration）。
 * < 60s: "12s"（整数秒）
 * 1m-1h: "2m 15s"
 * > 1h: "1h 5m"
 */
export function formatDuration(ms) {
  if (ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

/**
 * 格式化 token 数（对齐 Claude Code formatNumber，compact 记法）。
 * 900 → "900", 1321 → "1.3k", 3200 → "3.2k", 1000000 → "1m"
 */
export function formatTokens(n) {
  if (n < 1000) return `${n}`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}m`;
}

/**
 * Spinner 组件：agent 工作时显示旋转动画 + 动词 + 耗时 + token。
 * 对齐 Claude Code SpinnerAnimationRow。
 *
 * @param {object} props
 * @param {boolean} props.active - 是否在工作
 * @param {number} props.startTime - turn 开始时间戳
 * @param {number} props.responseLength - 响应字符数（用于估算 token）
 * @param {object} props.usage - 真实 token 用量（优先用 outputTokens）
 * @param {string} props.currentToolName - 当前执行的工具名（有则替代动词）
 * @param {boolean} props.hasActiveTools - 是否有工具在执行（stalled 检测时豁免）
 */
export const Spinner = memo(function Spinner({
  active,
  startTime = 0,
  responseLength = 0,
  usage = null,
  currentToolName = null,
  hasActiveTools = false,
}) {
  // 单一时钟驱动所有动画（对齐 Claude Code 的全局共享 ClockContext）
  const [time, setTime] = useState(0);
  // 随机动词（挂载时选一次，不轮换）
  const [verb] = useState(() => VERBS[Math.floor(Math.random() * VERBS.length)]);
  // token 平滑递增的 ref
  const tokenCounterRef = useRef(0);
  // responseLength 快照（检测 stalled）
  const lastResponseLengthRef = useRef(0);
  const lastGrowthTimeRef = useRef(0);

  // 动画时钟
  useEffect(() => {
    if (!active) { setTime(0); tokenCounterRef.current = 0; lastResponseLengthRef.current = 0; return; }
    const startMs = startTime || Date.now();
    const timer = setInterval(() => {
      setTime(Date.now() - startMs);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [active, startTime]);

  if (!active || time === 0) return null;

  const elapsed = time;

  // === 帧字符 ===
  const frameIdx = Math.floor(time / FRAME_DIVISOR) % SPINNER_FRAMES.length;
  const glyph = SPINNER_FRAMES[frameIdx];

  // === 动词（工具名优先）===
  const displayVerb = currentToolName || verb;
  const message = `${displayVerb}…`;

  // === token 计算（平滑递增）===
  // 真实 token 优先（usage.outputTokens），降级用 responseLength/4
  const targetTokens = usage?.outputTokens != null
    ? usage.outputTokens
    : Math.round(responseLength / 4);

  // 平滑递增动画
  const gap = targetTokens - tokenCounterRef.current;
  if (gap > 0) {
    let increment;
    if (gap < 70) increment = 3;
    else if (gap < 200) increment = Math.max(8, Math.ceil(gap * 0.15));
    else increment = 50;
    tokenCounterRef.current = Math.min(tokenCounterRef.current + increment, targetTokens);
  }
  const displayTokens = tokenCounterRef.current;

  // === stalled 检测 ===
  // responseLength 增长时记录时间；有工具执行时不计 stall
  if (responseLength > lastResponseLengthRef.current) {
    lastResponseLengthRef.current = responseLength;
    lastGrowthTimeRef.current = time;
  }
  const timeSinceGrowth = hasActiveTools ? 0
    : (responseLength > 0 ? time - lastGrowthTimeRef.current : time);
  const isStalled = timeSinceGrowth > STALL_THRESHOLD_MS && !hasActiveTools;
  const stalledIntensity = isStalled
    ? Math.min((timeSinceGrowth - STALL_THRESHOLD_MS) / STALL_RAMP_MS, 1)
    : 0;

  // 颜色：正常 yellow，stalled 时渐变到 red（两档近似）
  const glyphColor = stalledIntensity > 0.5 ? 'red' : 'yellow';
  const verbColor = stalledIntensity > 0.7 ? 'red' : undefined;

  // === 渐进式显示门控 ===
  const showTimerTokens = elapsed >= SHOW_TOKENS_AFTER_MS;
  const timerText = formatDuration(elapsed);
  const tokenText = `${formatTokens(displayTokens)} tokens`;

  // === shimmer 流光（简化版：用 bold 在动词上做扫光，每 200ms 移一位）===
  const glimmerPos = Math.floor(time / 200) % Math.max(message.length, 1);

  return React.createElement(
    Box,
    { flexDirection: 'row', marginTop: 0, paddingLeft: 1 },
    // 旋转字符
    React.createElement(Text, { color: glyphColor }, glyph + ' '),
    // 动词（带 shimmer 扫光）
    stalledIntensity > 0.7
      ? React.createElement(Text, { color: 'red' }, message)
      : React.createElement(
          Text,
          { dimColor: !currentToolName },
          ...renderShimmerText(message, glimmerPos)
        ),
    // 耗时 + token（30 秒后显示，括号包裹，dimColor 分隔符）
    showTimerTokens && React.createElement(
      Text,
      { dimColor: true },
      ` (${timerText} · ${tokenText})`
    ),
    // stalled 标识
    isStalled && stalledIntensity > 0.5 && React.createElement(
      Text,
      { color: 'red', dimColor: true },
      ' ⚠'
    )
  );
});

/**
 * 渲染带 shimmer 扫光的文字。
 * glimmerPos 位置的字符用 bold 高亮，其余正常。
 */
function renderShimmerText(text, glimmerPos) {
  const parts = [];
  for (let i = 0; i < text.length; i++) {
    const isGlimmer = i === glimmerPos || i === glimmerPos + 1;
    parts.push(
      React.createElement(Text, { key: i, bold: isGlimmer }, text[i])
    );
  }
  return parts;
}

export default Spinner;
