/** 终端控制序列度量原语：渲染层 frames 与 PTY 字节流共用。 */

export function countOccurrences(text, needle) {
  if (!text || !needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/** 全清指纹（ink overflow / 缩宽时写 ESC[2J ESC[3J ESC[H） */
export const FULL_CLEAR_PATTERN = '\x1b[2J';
/** eraseLines 指纹：逐行 ESC[2K + ESC[1A 上移 */
export const ERASE_UP_PATTERN = '\x1b[1A';

export function countFullClears(output) {
  return countOccurrences(output, FULL_CLEAR_PATTERN);
}

export function countEraseLineUps(output) {
  return countOccurrences(output, ERASE_UP_PATTERN);
}
