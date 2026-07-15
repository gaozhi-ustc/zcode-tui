import stripAnsi from 'strip-ansi';

/**
 * 计算字符串在终端中的显示宽度。
 *
 * 纯 ASCII 直接数字符数；含 CJK 全角字符/emoji 按宽度 2 计算；
 * ANSI 转义码不计宽度。对齐 Claude Code 的 ambiguousAsWide:false 语义
 * （模糊宽度字符按窄处理）。
 *
 * @param {string} str
 * @returns {number}
 */
export function stringWidth(str) {
  if (typeof str !== 'string') return 0;
  // 含 ANSI 转义码先剥离
  if (str.includes('\x1b[')) str = stripAnsi(str);

  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    // 控制字符与零宽字符
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;
    if (isZeroWidth(code)) continue;
    // CJK 全角字符宽度 2
    if (isWide(code)) width += 2;
    else width += 1;
  }
  return width;
}

/** 判断 codepoint 是否为全角（宽度 2）。基于 East Asian Width。 */
function isWide(code) {
  return (
    // CJK 统一表意文字（常用汉字）
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals
    (code >= 0x3041 && code <= 0x33ff) || // 平假名/片假名/CJK 符号
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0xa000 && code <= 0xa4cf) || // 彝文
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul 音节
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式
    (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII
    (code >= 0xffe0 && code <= 0xffe6) || // 全角符号
    (code >= 0x1f300 && code <= 0x1faff) || // Emoji & symbols
    (code >= 0x20000 && code <= 0x3fffd) // CJK 扩展 B-F
  );
}

/** 判断 codepoint 是否零宽（组合标记、变体选择符等）。 */
function isZeroWidth(code) {
  return (
    code === 0x200b || // ZWSP
    code === 0x200c || // ZWNJ
    code === 0x200d || // ZWJ
    code === 0xfeff || // BOM
    (code >= 0xfe00 && code <= 0xfe0f) || // 变体选择符 VS1-VS16
    (code >= 0x0300 && code <= 0x036f) || // 组合附加符号
    (code >= 0x1ab0 && code <= 0x1aff) || // 组合附加符号扩展
    (code >= 0x1dc0 && code <= 0x1dff) || // 组合附加符号补充
    (code >= 0x20d0 && code <= 0x20ff) || // 符号组合附加符号
    (code >= 0xe0100 && code <= 0xe01ef) // 变体选择符补充
  );
}

export default stringWidth;
