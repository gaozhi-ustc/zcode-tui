/**
 * 按键标识工具函数。
 *
 * 注意：完整的 keybinding Provider/useKeybinding 系统（阶段五）已被移除，
 * 因为各组件用 ink 的 useInput + isActive 已实现了按键隔离，
 * Provider 层是未使用的死代码。仅保留 keyToKeystroke 和 DEFAULT_BINDINGS
 * 作为按键识别的工具函数（测试和文档参考用）。
 */

/**
 * 默认按键绑定映射（上下文 → { keystroke: action }）。
 * 对齐 Claude Code 的 defaultBindings.ts，供参考。
 */
export const DEFAULT_BINDINGS = {
  Global: {
    'ctrl+c': 'app:interrupt',
    'ctrl+l': 'app:redraw',
  },
  Chat: {
    'return': 'chat:submit',
    'shift+return': 'chat:newline',
    'escape': 'chat:cancel',
    'up': 'history:previous',
    'down': 'history:next',
    'ctrl+r': 'history:search',
  },
  Confirmation: {
    'y': 'confirm:yes',
    'n': 'confirm:no',
    'return': 'confirm:yes',
    'escape': 'confirm:no',
    'up': 'confirm:previous',
    'down': 'confirm:next',
  },
  Scroll: {
    'pageup': 'scroll:up',
    'pagedown': 'scroll:down',
    'ctrl+home': 'scroll:top',
    'ctrl+end': 'scroll:bottom',
  },
};

/**
 * 把 ink 的 input/key 转成按键标识字符串。
 */
export function keyToKeystroke(input, key) {
  if (key.ctrl && input) {
    const code = input.charCodeAt(0);
    const ch = code < 32 ? String.fromCharCode(code + 96) : input.toLowerCase();
    if (ch === 'c') return 'ctrl+c';
    if (ch === 'l') return 'ctrl+l';
    if (ch === 'x') return 'ctrl+x';
    if (ch === 'r') return 'ctrl+r';
    if (ch === 'a') return 'ctrl+a';
    if (ch === 'e') return 'ctrl+e';
    if (ch === 'h') return 'ctrl+h';
    if (ch === 'd') return 'ctrl+d';
    if (ch === 'o') return 'ctrl+o';
    if (ch === 't') return 'ctrl+t';
    return `ctrl+${ch}`;
  }
  if (key.meta && input) return `meta+${input.toLowerCase()}`;
  if (key.shift && key.return) return 'shift+return';
  if (key.escape) return 'escape';
  if (key.return) return 'return';
  if (key.tab) return key.shift ? 'shift+tab' : 'tab';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.backspace) return 'backspace';
  if (key.delete) return 'delete';
  if (key.pageUp) return 'pageup';
  if (key.pageDown) return 'pagedown';
  if (input && input.length === 1 && !key.ctrl && !key.meta) return input;
  return null;
}
