import React, { memo, useRef, useMemo, Suspense, useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { marked } from 'marked';
import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import { Ansi } from './Ansi.js';
import { stringWidth } from './string-width.js';
import { formatToken, setHighlightModule, warmupHighlight } from './format-token.js';
import { MarkdownTable } from './MarkdownTable.js';

// marked 配置：禁用删除线（模型常把 ~ 当约号用）
marked.use({ tokenizer: { del() { return undefined; } } });

// 快速检测是否含 Markdown 语法（无语法时跳过 lexer，直接当纯文本）
const HAS_MD_SYNTAX = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;

// token 缓存（LRU，max 500），避免滚动回看旧消息重复 lexer
const tokenCache = new Map();
const TOKEN_CACHE_MAX = 500;

function cachedLexer(content) {
  const key = content.length + ':' + content.slice(0, 64) + content.slice(-32);
  if (tokenCache.has(key)) {
    // promote to MRU
    const val = tokenCache.get(key);
    tokenCache.delete(key);
    tokenCache.set(key, val);
    return val;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    // 淘汰最旧
    const firstKey = tokenCache.keys().next().value;
    tokenCache.delete(firstKey);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

// 懒加载语法高亮模块
let _highlightLoaded = false;
const _highlightCallbacks = [];
async function loadHighlight() {
  if (_highlightLoaded) return;
  _highlightLoaded = true; // 防止重复加载
  try {
    const mod = await import('cli-highlight');
    setHighlightModule(mod.default || mod);
    // 通知所有等待的组件重渲染
    _highlightCallbacks.forEach(cb => cb());
    _highlightCallbacks.length = 0;
  } catch { /* 降级纯文本 */ }
}

/**
 * Markdown 渲染组件（完整版）。
 * 词法分析 → formatToken 着色 → <Ansi> 渲染；表格单独走 <MarkdownTable>。
 */
export const Markdown = memo(function Markdown({ children }) {
  const content = typeof children === 'string' ? children : '';
  const [, setHighlightVersion] = useState(0);

  // 启动时预热语法高亮，加载完成后重渲染以显示高亮
  useEffect(() => {
    if (!_highlightLoaded) {
      _highlightCallbacks.push(() => setHighlightVersion(v => v + 1));
      loadHighlight();
    }
  }, []);

  // 无 markdown 语法的纯文本，直接渲染
  if (content === '' || !HAS_MD_SYNTAX.test(content.slice(0, 500))) {
    return React.createElement(Ansi, null, content);
  }

  const tokens = cachedLexer(content);

  // 分离表格和非表格内容
  const elements = [];
  let ansiBuf = '';
  let keyIdx = 0;

  const flushBuf = () => {
    if (ansiBuf.trim()) {
      elements.push(React.createElement(Ansi, { key: keyIdx++ }, ansiBuf.trim()));
    }
    ansiBuf = '';
  };

  for (const token of tokens) {
    if (token.type === 'table') {
      flushBuf();
      elements.push(React.createElement(MarkdownTable, { key: keyIdx++, token }));
    } else {
      ansiBuf += formatToken(token);
    }
  }
  flushBuf();

  return React.createElement(Box, { flexDirection: 'column', gap: 0 }, ...elements);
});

/**
 * 流式 Markdown 渲染：在最后一个顶层块边界切分。
 * 稳定前缀用 memoized <Markdown>（不重解析），不稳定后缀每次重解析。
 * 对齐 Claude Code 的 StreamingMarkdown。
 */
export const StreamingMarkdown = memo(function StreamingMarkdown({ children }) {
  const content = typeof children === 'string' ? children : '';
  const stablePrefixRef = useRef('');

  // 防御性重置：内容不再以旧前缀开头（如重写），清空
  if (!content.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = '';
  }

  const boundary = stablePrefixRef.current.length;
  const suffix = content.substring(boundary);
  const tokens = suffix ? marked.lexer(suffix) : [];

  // 找最后一个非 space token（正在生长的块）
  let lastContentIdx = tokens.length - 1;
  while (lastContentIdx >= 0 && tokens[lastContentIdx].type === 'space') lastContentIdx--;

  // 推进边界：最后一个内容 token 之前的都是已完成的
  let advance = 0;
  for (let i = 0; i < lastContentIdx; i++) advance += tokens[i].raw.length;
  if (advance > 0) stablePrefixRef.current = content.substring(0, boundary + advance);

  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = content.substring(stablePrefix.length);

  return React.createElement(
    Box,
    { flexDirection: 'column', gap: 0 },
    stablePrefix && React.createElement(Markdown, { key: 'stable' }, stablePrefix),
    unstableSuffix && React.createElement(Markdown, { key: 'unstable' }, unstableSuffix)
  );
});

export default Markdown;
