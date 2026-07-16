import chalk from 'chalk';

// cli-highlight 懒加载单例（首次渲染代码块时才 import）
let _highlightPromise = null;
function getHighlight() {
  if (!_highlightPromise) {
    _highlightPromise = import('cli-highlight')
      .then(m => m.default || m)
      .catch(() => null);
  }
  return _highlightPromise;
}

/**
 * 预热语法高亮模块（启动时调用，避免首次代码块渲染卡顿）。
 */
export function warmupHighlight() {
  getHighlight();
}

/**
 * 把 marked 的 token 转成带 ANSI 颜色的字符串。
 * 对齐 Claude Code 的 formatToken（utils/markdown.ts）。
 *
 * @param {object} token - marked Token
 * @param {number} listDepth - 列表嵌套深度
 * @param {number|null} orderedNum - 有序列表当前编号
 * @param {object|null} parent - 父 token（用于判断 text 在 list_item/link 内）
 * @returns {string} ANSI 着色字符串
 */
export function formatToken(token, listDepth = 0, orderedNum = null, parent = null) {
  if (!token) return '';

  switch (token.type) {
    case 'heading': {
      const text = innerTokensText(token.tokens, listDepth, null, token);
      if (token.depth === 1) return chalk.bold.italic.underline(text) + '\n\n';
      if (token.depth === 2) return chalk.bold(text) + '\n\n';
      return chalk.bold(text) + '\n\n';
    }

    case 'paragraph': {
      return innerTokensText(token.tokens, listDepth, orderedNum, token) + '\n';
    }

    case 'code': {
      return formatCodeBlock(token.text, token.lang) + '\n';
    }

    case 'codespan': {
      // 行内代码用 permission 色（与 Claude Code 一致用黄色系）
      return chalk.yellow(token.text);
    }

    case 'strong': {
      const inner = innerTokensText(token.tokens, listDepth, orderedNum, token);
      return chalk.bold(inner);
    }

    case 'em': {
      const inner = innerTokensText(token.tokens, listDepth, orderedNum, token);
      return chalk.italic(inner);
    }

    case 'del': {
      const inner = innerTokensText(token.tokens, listDepth, orderedNum, token);
      return chalk.strikethrough(inner);
    }

    case 'hr': {
      return chalk.dim('---') + '\n';
    }

    case 'br': {
      return '\n';
    }

    case 'space': {
      return token.raw || '\n';
    }

    case 'blockquote': {
      const bar = chalk.cyan('▎');
      // 每行加前缀，正文用 italic
      const lines = (token.text || '').split('\n');
      return lines.map(line =>
        line.trim() === '' ? '' : `${bar} ${chalk.italic(line)}`
      ).join('\n') + '\n';
    }

    case 'link': {
      const linkText = innerTokensText(token.tokens, listDepth, orderedNum, token);
      // 显示文本==URL 时不重复显示
      if (token.href === linkText || linkText === '') return chalk.cyan.underline(token.href);
      return `${linkText} ${chalk.cyan.dim(`(${token.href})`)}`;
    }

    case 'list': {
      return (token.items || []).map((item, idx) => {
        const num = token.ordered ? (token.start || 1) + idx : null;
        return formatListItem(item, listDepth, num);
      }).join('');
    }

    case 'text': {
      // 在 list_item 内：加列表标记前缀
      if (parent && parent.type === 'list_item') {
        const indent = '  '.repeat(listDepth);
        const marker = orderedNum != null ? `${orderedNum}. ` : '- ';
        return indent + marker + (token.text || '') + '\n';
      }
      // 在 link 内：返回原文
      if (parent && parent.type === 'link') return token.text || '';
      return token.text || '';
    }

    case 'escape': {
      return token.text || '';
    }

    case 'image': {
      return chalk.cyan.dim(`[image: ${token.href}]`);
    }

    case 'html': {
      return ''; // 不渲染原始 HTML
    }

    case 'def': {
      return '';
    }

    case 'table': {
      // 表格由 Markdown 组件单独处理（MarkdownTable 组件）
      // formatToken 退化用 ASCII 表格
      return formatSimpleTable(token) + '\n';
    }

    default: {
      return token.raw || token.text || '';
    }
  }
}

/** 处理 inner tokens（paragraph/heading/strong/em 内的子 token）。 */
function innerTokensText(tokens, listDepth, orderedNum, parent) {
  if (!tokens) return '';
  return tokens.map(t => formatToken(t, listDepth, orderedNum, parent)).join('');
}

/** 格式化列表项。 */
function formatListItem(item, listDepth, orderedNum) {
  if (!item) return '';
  // list_item 的子 token 可能是 text/paragraph/list 等
  const inner = (item.tokens || []).map(t => {
    if (t.type === 'text') {
      const indent = '  '.repeat(listDepth);
      const marker = orderedNum != null ? `${orderedNum}. ` : '- ';
      // text token 内可能还有嵌套 tokens
      const textContent = t.tokens ? innerTokensText(t.tokens, listDepth, null, item) : (t.text || '');
      // 多行内容续行缩进
      const lines = textContent.split('\n');
      return lines.map((line, i) => i === 0 ? `${indent}${marker}${line}` : `${indent}  ${line}`).join('\n') + '\n';
    }
    if (t.type === 'list') {
      return formatToken(t, listDepth + 1, null, item);
    }
    return formatToken(t, listDepth, orderedNum, item);
  }).join('');
  return inner;
}

/**
 * 格式化代码块，带语法高亮。
 * 高亮模块懒加载，未就绪时降级纯文本。
 */
let _highlightReady = null;
export async function ensureHighlightReady() {
  if (_highlightReady === null) {
    _highlightReady = false;
    try {
      const hl = await getHighlight();
      _highlightReady = hl;
    } catch { _highlightReady = false; }
  }
  return _highlightReady;
}

function formatCodeBlock(text, lang) {
  // 优先用 cli-highlight 同步高亮（模块已加载时）
  if (_highlightModule && lang) {
    try {
      if (_highlightModule.supportsLanguage(lang)) {
        return _highlightModule.highlight(text, { language: lang }) + '\n';
      }
    } catch { /* 降级 */ }
  }
  // 降级：dim 纯文本
  return chalk.dim(text) + '\n';
}

/** 同步高亮代码块（如果 highlight 已加载）。 */
export function highlightCodeSync(text, lang) {
  // cli-highlight 是同步可用的（require 返回即用），但我们用动态 import
  // 这里用全局缓存做同步访问
  if (_highlightModule && lang && _highlightModule.supportsLanguage(lang)) {
    try {
      return _highlightModule.highlight(text, { language: lang });
    } catch {
      return text;
    }
  }
  return text;
}

let _highlightModule = null;
export function setHighlightModule(mod) {
  _highlightModule = mod;
}

/** 退化版 ASCII 表格（MarkdownTable 组件会用更好的版本）。 */
function formatSimpleTable(token) {
  if (!token || !token.header) return '';
  const headerCells = token.header.map(h => h.text || '');
  const rows = (token.rows || []).map(r => r.map(c => c.text || ''));
  const all = [headerCells, ...rows];
  const widths = headerCells.map((_, i) => Math.max(...all.map(r => r[i] || '').map(s => s.length)));
  const sep = widths.map(w => '-'.repeat(w)).join(' | ');
  const lines = [headerCells.map((c, i) => c.padEnd(widths[i])).join(' | '), sep];
  for (const row of rows) {
    lines.push(row.map((c, i) => (c || '').padEnd(widths[i])).join(' | '));
  }
  return lines.join('\n');
}

export default formatToken;
