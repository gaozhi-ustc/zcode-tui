import React, { useState, useRef, useEffect } from 'react';
import { Text, Box, useInput, useStdout } from 'ink';
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

// 输入历史文件
const HISTORY_FILE = `${process.env.HOME}/.zcode/tui-history`;
const MAX_HISTORY = 200;

function loadHistory() {
  try {
    return readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-MAX_HISTORY);
  } catch { return []; }
}

function saveHistory(history) {
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    writeFileSync(HISTORY_FILE, history.slice(-MAX_HISTORY).join('\n'));
  } catch { /* 历史保存失败不影响使用 */ }
}

// @ 文件提及：补全当前路径
function getFileSuggestions(prefix) {
  if (!prefix) return [];
  const dir = prefix.includes('/') ? dirname(prefix) : '.';
  const part = prefix.includes('/') ? basename(prefix) : prefix;
  try {
    const fullDir = dir === '.' ? process.cwd() : dir;
    if (!existsSync(fullDir)) return [];
    return readdirSync(fullDir)
      .filter(f => f.startsWith(part) && !f.startsWith('.'))
      .slice(0, 10)
      .map(f => {
        try {
          const isDir = statSync(join(fullDir, f)).isDirectory();
          return dir === '.' ? (isDir ? `${f}/` : f) : (isDir ? `${dir}/${f}/` : `${dir}/${f}`);
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * 增强版输入框：
 * - 多行输入：Shift+Enter 或 Alt+Enter 换行；Enter 提交
 * - 输入历史：↑↓ 翻历史
 * - @ 文件提及：输入 @ 后补全文件路径
 * 对齐 Claude Code 的 useTextInput + useArrowKeyHistory。
 */
export function InputBox({ onSubmit }) {
  const [lines, setLines] = useState(['']);
  const [curLine, setCurLine] = useState(0);
  const [curCol, setCurCol] = useState(0);
  const historyRef = useRef(loadHistory());
  const historyIdxRef = useRef(-1); // -1 = 不在浏览历史模式
  const draftRef = useRef(''); // 浏览历史前的草稿
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const { stdout, write: writeStdout } = useStdout();

  const currentText = lines[curLine] || '';
  const multiline = lines.length > 1;

  // 检测 @ 文件提及
  useEffect(() => {
    const text = lines[curLine] || '';
    const atMatch = text.match(/@([^\s@]*)$/);
    if (atMatch) {
      const sugg = getFileSuggestions(atMatch[1]);
      setSuggestions(sugg);
      setSuggestionIdx(0);
    } else {
      setSuggestions([]);
    }
  }, [lines, curLine]);

  useInput((input, key) => {
    // Ctrl+L：完整重绘（修复增量渲染发散导致的残影/覆盖）
    // 注意放在 InputBox 而非 App 全局 useInput：实测 App 顶层 useInput
    // 在当前组件结构下收不到按键（原因待查），InputBox 稳定接收
    if (key.ctrl && input === 'l') {
      writeStdout('');
      return;
    }
    // Tab 接受补全建议
    if (key.tab && suggestions.length > 0) {
      const sugg = suggestions[suggestionIdx];
      setLines(prev => {
        const updated = [...prev];
        const text = updated[curLine] || '';
        updated[curLine] = text.replace(/@([^\s@]*)$/, `@${sugg}`);
        return updated;
      });
      setSuggestions([]);
      return;
    }
    // 补全建议导航
    if (suggestions.length > 0) {
      if (key.upArrow) { setSuggestionIdx(i => (i - 1 + suggestions.length) % suggestions.length); return; }
      if (key.downArrow) { setSuggestionIdx(i => (i + 1) % suggestions.length); return; }
      if (key.escape) { setSuggestions([]); return; }
    }

    // 提交：Enter（无修饰键）
    if (key.return) {
      if (key.shift || key.meta || key.ctrl) {
        // 换行
        setLines(prev => {
          const updated = [...prev];
          updated.splice(curLine + 1, 0, '');
          return updated;
        });
        setCurLine(c => c + 1);
        setCurCol(0);
      } else {
        const text = lines.join('\n');
        if (text.trim()) {
          // 保存到历史
          const hist = historyRef.current;
          if (hist[hist.length - 1] !== text && !text.startsWith('/')) {
            hist.push(text);
            saveHistory(hist);
          }
          historyIdxRef.current = -1;
          onSubmit(text);
          setLines(['']);
          setCurLine(0);
          setCurCol(0);
        }
      }
      return;
    }

    // 历史导航：↑↓（单行模式下）
    if (!multiline) {
      if (key.upArrow) {
        const hist = historyRef.current;
        if (hist.length === 0) return;
        if (historyIdxRef.current === -1) {
          draftRef.current = lines[0] || '';
          historyIdxRef.current = hist.length;
        }
        if (historyIdxRef.current > 0) {
          historyIdxRef.current--;
          setLines([hist[historyIdxRef.current]]);
          setCurCol(hist[historyIdxRef.current].length);
        }
        return;
      }
      if (key.downArrow) {
        const hist = historyRef.current;
        if (historyIdxRef.current === -1) return;
        if (historyIdxRef.current < hist.length - 1) {
          historyIdxRef.current++;
          setLines([hist[historyIdxRef.current]]);
          setCurCol(hist[historyIdxRef.current].length);
        } else {
          historyIdxRef.current = -1;
          setLines([draftRef.current]);
          setCurCol(draftRef.current.length);
        }
        return;
      }
    } else {
      // 多行模式：↑↓ 在行间移动
      if (key.upArrow && curLine > 0) { setCurLine(c => c - 1); return; }
      if (key.downArrow && curLine < lines.length - 1) { setCurLine(c => c + 1); return; }
    }

    // 普通字符输入
    if (input && !key.ctrl && !key.meta && input !== '\r' && input !== '\n') {
      setLines(prev => {
        const updated = [...prev];
        const text = updated[curLine] || '';
        updated[curLine] = text.slice(0, curCol) + input + text.slice(curCol);
        return updated;
      });
      setCurCol(c => c + input.length);
      historyIdxRef.current = -1;
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setLines(prev => {
        const updated = [...prev];
        const text = updated[curLine] || '';
        if (curCol > 0) {
          updated[curLine] = text.slice(0, curCol - 1) + text.slice(curCol);
          setCurCol(c => c - 1);
        } else if (curLine > 0) {
          // 删除换行符合并到上一行
          const prevText = updated[curLine - 1] || '';
          updated[curLine - 1] = prevText + text;
          updated.splice(curLine, 1);
          setCurLine(c => c - 1);
          setCurCol(prevText.length);
        }
        return updated;
      });
      historyIdxRef.current = -1;
      return;
    }

    // 左右移动
    if (key.leftArrow) {
      if (curCol > 0) setCurCol(c => c - 1);
      else if (curLine > 0) { setCurLine(c => c - 1); setCurCol((lines[curLine - 1] || '').length); }
      return;
    }
    if (key.rightArrow) {
      if (curCol < (lines[curLine] || '').length) setCurCol(c => c + 1);
      else if (curLine < lines.length - 1) { setCurLine(c => c + 1); setCurCol(0); }
      return;
    }

    // Ctrl+A 行首，Ctrl+E 行尾
    if (input === '\x01') { setCurCol(0); return; } // Ctrl+A
    if (input === '\x05') { setCurCol((lines[curLine] || '').length); return; } // Ctrl+E
  });

  // 渲染
  const showCursor = stdout?.isTTY !== false;
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    // 补全建议浮层
    suggestions.length > 0 && React.createElement(
      Box,
      { flexDirection: 'column', marginBottom: 0 },
      ...suggestions.map((s, i) =>
        React.createElement(Text, {
          key: s,
          color: i === suggestionIdx ? 'black' : undefined,
          backgroundColor: i === suggestionIdx ? 'cyan' : undefined,
        }, ` ${s} `)
      )
    ),
    // 多行渲染
    React.createElement(
      Box,
      { flexDirection: 'row' },
      React.createElement(Text, { color: 'cyan' }, multiline ? '┌ ' : '> '),
      React.createElement(
        Box,
        { flexDirection: 'column' },
        ...lines.map((line, i) => {
          const isCurrent = i === curLine;
          const prefix = multiline ? (i === 0 ? '' : '│ ') : '';
          if (isCurrent) {
            // 当前行显示光标
            const before = line.slice(0, curCol);
            const cursorChar = line[curCol] || ' ';
            const after = line.slice(curCol + 1);
            return React.createElement(
              Box,
              { key: i, flexDirection: 'row' },
              React.createElement(Text, null, prefix + before),
              React.createElement(Text, { inverse: true }, cursorChar),
              React.createElement(Text, null, after)
            );
          }
          return React.createElement(Text, { key: i }, prefix + line);
        })
      )
    )
  );
}

export default InputBox;
