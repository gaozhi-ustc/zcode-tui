import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';

// Spinner 动画字符（对齐 Claude Code 的 getDefaultCharacters）
const SPINNER_FRAMES_BASE = ['·', '✢', '✳', '✶', '✻', '✽'];
// 往返动画：[正序 + 逆序]，让动画更流畅
const SPINNER_FRAMES = [...SPINNER_FRAMES_BASE, ...[...SPINNER_FRAMES_BASE].reverse().slice(1, -1)];

// 动画间隔（毫秒）。Claude Code 用 50ms，但我们降到 120ms 减少重渲染
const FRAME_INTERVAL_MS = 120;
// 30 秒后显示 token 数（对齐 Claude Code 的 SHOW_TOKENS_AFTER_MS）
const SHOW_TOKENS_AFTER_MS = 30000;

// 思考动词（从 Claude Code SPINNER_VERBS 中精选）
const THINKING_VERBS = [
  'Thinking', 'Processing', 'Analyzing', 'Computing', 'Reasoning',
  'Pondering', 'Reflecting', 'Working', 'Generating', 'Crafting',
];

/**
 * 全局 Spinner 行（对齐 Claude Code 的 SpinnerAnimationRow）。
 * 显示在消息列表底部，agent 工作时显示动画 + 动词 + 耗时 + token。
 *
 * @param {object} props
 * @param {boolean} props.active - 是否在工作中
 * @param {number} props.startTime - 开始时间戳（毫秒）
 * @param {number} props.responseLength - 响应长度（用于估算 token）
 */
export function Spinner({ active, startTime, responseLength = 0, currentToolName }) {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [verbIdx, setVerbIdx] = useState(0);
  const startTimeRef = useRef(startTime);

  useEffect(() => {
    startTimeRef.current = startTime;
  }, [startTime]);

  // 动画帧
  useEffect(() => {
    if (!active) return;
    const frameTimer = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(frameTimer);
  }, [active]);

  // 耗时更新 + 动词轮换
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const tick = setInterval(() => {
      const ms = Date.now() - (startTimeRef.current || Date.now());
      setElapsed(ms);
      // 每 5 秒换一个动词
      setVerbIdx(Math.floor(ms / 5000) % THINKING_VERBS.length);
    }, 1000);
    return () => clearInterval(tick);
  }, [active]);

  if (!active) return null;

  const glyph = SPINNER_FRAMES[frame] || '·';
  const verb = currentToolName ? currentToolName : THINKING_VERBS[verbIdx] || 'Thinking';
  const elapsedStr = formatElapsed(elapsed);

  // token 估算：响应字符数 / 4（粗略估算，对齐 Claude Code 的前端自给自足方式）
  const showTokens = elapsed >= SHOW_TOKENS_AFTER_MS && responseLength > 0;
  const estTokens = Math.round(responseLength / 4);
  const tokenStr = showTokens ? ` · ${formatTokens(estTokens)} tok` : '';

  return React.createElement(
    Box,
    { flexDirection: 'row', paddingLeft: 1, marginTop: 0 },
    React.createElement(Text, { color: 'yellow' }, glyph + ' '),
    React.createElement(Text, { dimColor: true }, verb),
    elapsedStr && React.createElement(Text, { dimColor: true }, ` · ${elapsedStr}`),
    tokenStr && React.createElement(Text, { dimColor: true }, tokenStr)
  );
}

function formatElapsed(ms) {
  if (!ms || ms < 1000) return '';
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${s}s`;
}

function formatTokens(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
}

export default Spinner;
