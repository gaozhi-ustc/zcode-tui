import stripAnsi from 'strip-ansi';

/**
 * 净化进入渲染管线的文本内容。
 *
 * 现场 bug（2026-07-24）：工具结果捕获了远程 pty 会话输出，内容含 \r
 * （回车）与 ANSI 序列。终端把 \r 解释为"光标回行首"，后续文字覆盖行首，
 * 多行内容混叠成乱码且 Ctrl+L 无法修复（污染在数据本身）。
 *
 * 处理：
 * - strip-ansi 去除 ANSI 转义序列（远程彩色输出/TUI 残留）
 * - \r\n → \n；孤立的 \r → \n（把"回车覆盖段"展开为独立行，保留全部信息）
 */
export function sanitizeText(s) {
  if (typeof s !== 'string' || s === '') return s;
  // 快速路径：无 \r 且无 ESC 时零开销
  if (s.indexOf('\r') === -1 && s.indexOf('\x1b') === -1) return s;
  return stripAnsi(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
