import React, { memo } from 'react';
import { Text } from 'ink';

/**
 * Ansi 组件：把含 ANSI 转义码（chalk 产生）的字符串解析成 ink <Text> 树。
 *
 * 这是 Claude Code 渲染管线的核心桥接：formatToken 用 chalk 产出 ANSI 字符串，
 * <Ansi> 把它解析回带样式的 React 组件。
 *
 * 支持的 SGR 码：0(重置) 1(bold) 2(dim) 3(italic) 4(underline) 22/23/24(取消)
 * 30-37(前景色) 90-97(bright) 38;5;N(256色) 38;2;r;g;b(truecolor) 39(默认前景)
 *
 * @param {{children: string, dimColor?: boolean}} props
 */
export const Ansi = memo(function Ansi({ children, dimColor = false }) {
  if (typeof children !== 'string') {
    return React.createElement(Text, { dim: dimColor }, String(children ?? ''));
  }
  if (children === '') return null;

  const spans = parseAnsi(children);
  if (spans.length === 0) return null;

  // 单 span 无样式 → 直接 Text
  if (spans.length === 1 && !hasStyle(spans[0].style)) {
    return React.createElement(Text, { dim: dimColor }, spans[0].text);
  }

  return React.createElement(
    Text,
    { dim: dimColor },
    ...spans.map((span, i) => renderSpan(span, i))
  );
});

function renderSpan(span, key) {
  const s = span.style;
  const props = {};
  if (s.bold) props.bold = true;
  if (s.italic) props.italic = true;
  if (s.underline) props.underline = true;
  if (s.strikethrough) props.strikethrough = true;
  if (s.dim) props.dim = true;
  if (s.color) props.color = s.color;
  if (s.bgColor) props.backgroundColor = s.bgColor;

  // 无样式纯文本直接返回字符串
  if (Object.keys(props).length === 0) return span.text;
  return React.createElement(Text, { key, ...props }, span.text);
}

function hasStyle(s) {
  return s.bold || s.italic || s.underline || s.strikethrough || s.dim || s.color || s.bgColor;
}

const NAMED_COLORS = {
  30: 'black', 31: 'red', 32: 'green', 33: 'yellow',
  34: 'blue', 35: 'magenta', 36: 'cyan', 37: 'white',
};
const BRIGHT_COLORS = {
  90: 'blackBright', 91: 'redBright', 92: 'greenBright', 93: 'yellowBright',
  94: 'blueBright', 95: 'magentaBright', 96: 'cyanBright', 97: 'whiteBright',
};

/** 默认（重置）样式 */
function defaultStyle() {
  return { bold: false, dim: false, italic: false, underline: false, strikethrough: false, color: null, bgColor: null };
}

/** 解析 ANSI 字符串为 span 数组。每个 span = {text, style}。 */
function parseAnsi(str) {
  const spans = [];
  let current = defaultStyle();
  let textBuf = '';
  // CSI 序列正则：\x1b[ 后跟参数和 final byte
  const re = /\x1b\[([\d;:]*)m/g;
  let last = 0;
  let match;

  const flush = () => {
    if (textBuf) {
      spans.push({ text: textBuf, style: { ...current } });
      textBuf = '';
    }
  };

  while ((match = re.exec(str)) !== null) {
    // CSI 前的文本
    if (match.index > last) {
      textBuf += str.slice(last, match.index);
    }
    // 样式变化前先 flush 当前文本段
    flush();
    // 应用 SGR 参数
    applySGR(current, match[1]);
    last = re.lastIndex;
  }
  // 剩余文本
  if (last < str.length) textBuf += str.slice(last);
  flush();

  return spans;
}

/** 应用 SGR 参数到 style 对象（原地修改）。 */
function applySGR(style, params) {
  if (params === '' || params === '0') {
    Object.assign(style, defaultStyle());
    return;
  }
  const codes = params.split(';').map(n => parseInt(n, 10));
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) Object.assign(style, defaultStyle());
    else if (c === 1) style.bold = true;
    else if (c === 2) style.dim = true;
    else if (c === 3) style.italic = true;
    else if (c === 4) style.underline = true;
    else if (c === 9) style.strikethrough = true;
    else if (c === 22) { style.bold = false; style.dim = false; }
    else if (c === 23) style.italic = false;
    else if (c === 24) style.underline = false;
    else if (c === 29) style.strikethrough = false;
    else if (NAMED_COLORS[c]) style.color = NAMED_COLORS[c];
    else if (c === 39) style.color = null;
    else if (BRIGHT_COLORS[c]) style.color = BRIGHT_COLORS[c];
    else if (c >= 40 && c <= 47) style.bgColor = NAMED_COLORS[c - 10];
    else if (c === 49) style.bgColor = null;
    else if (c >= 100 && c <= 107) style.bgColor = BRIGHT_COLORS[c - 10];
    else if (c === 38 && codes[i + 1] === 5) { style.color = `ansi256(${codes[i + 2]})`; i += 2; }
    else if (c === 48 && codes[i + 1] === 5) { style.bgColor = `ansi256(${codes[i + 2]})`; i += 2; }
    else if (c === 38 && codes[i + 1] === 2) { style.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
    else if (c === 48 && codes[i + 1] === 2) { style.bgColor = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
  }
}

export default Ansi;
