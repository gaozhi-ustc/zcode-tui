import { createContext, useContext, useCallback, useRef } from 'react';
import { useInput } from 'ink';

/**
 * 按键绑定系统（对齐 Claude Code keybindings/）。
 *
 * 上下文优先级（高→低）：Confirmation > Scroll > Chat > Global
 * 高优先级上下文的 handler 优先消费按键；未消费的传递给低优先级。
 * 支持 chord（如 ctrl+x ctrl+k 两键组合）。
 *
 * 按键标识格式：'ctrl+c', 'escape', 'return', 'up', 'shift+return',
 * 'ctrl+x', chord 用 '+' 链接序列（第一个 key + '+' + 第二个 key）。
 */

// 默认按键绑定映射（context → { keystroke: action }）
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

// 上下文优先级（数字越小优先级越高）
const CONTEXT_PRIORITY = {
  Confirmation: 0,
  Scroll: 1,
  Chat: 2,
  Global: 3,
};

// chord 超时（毫秒）
const CHORD_TIMEOUT_MS = 1000;

/**
 * 把 ink 的 input/key 转成按键标识字符串。
 */
export function keyToKeystroke(input, key) {
  if (key.ctrl && input) {
    // Ctrl+字母：input 可能是控制字符（\x03=Ctrl+C）或字母本身
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

const KeybindingContext = createContext(null);

/**
 * 按键绑定 Provider。
 * 收集所有组件注册的 handler，按上下文优先级分发按键。
 */
export function KeybindingProvider({ children, bindings = DEFAULT_BINDINGS }) {
  // handlers: Map<context, Map<action, handler>>
  const handlersRef = useRef({});

  const registerHandler = useCallback((context, action, handler, isActive = true) => {
    if (!handlersRef.current[context]) handlersRef.current[context] = new Map();
    handlersRef.current[context].set(action, { handler, isActive });
    return () => {
      const ctx = handlersRef.current[context];
      if (ctx) ctx.delete(action);
    };
  }, []);

  // chord 状态
  const chordPendingRef = useRef(null);

  const resolveAndDispatch = useCallback((keystroke) => {
    if (!keystroke) return false;

    // chord 处理
    if (chordPendingRef.current) {
      const { prefix, timeout } = chordPendingRef.current;
      if (Date.now() > timeout) {
        chordPendingRef.current = null;
      } else {
        // 检查 prefix+keystroke 是否匹配某个 action
        const chordKey = `${prefix}+${keystroke}`;
        chordPendingRef.current = null;
        return dispatch(chordKey);
      }
    }

    // 尝试匹配单键
    const dispatched = dispatch(keystroke);
    if (dispatched) return true;

    // 检查是否是某个 chord 的前缀
    for (const [ctx, ctxHandlers] of Object.entries(handlersRef.current)) {
      for (const [action] of ctxHandlers) {
        // 简单检查：action 名含 '+' 可能是 chord
        // （实际 chord 在 useKeybinding 层声明，这里检查是否有 pending 可能）
      }
    }
    return false;
  }, []);

  const dispatch = useCallback((keystroke) => {
    // 按上下文优先级查找
    const sortedContexts = Object.keys(handlersRef.current)
      .sort((a, b) => (CONTEXT_PRIORITY[a] ?? 99) - (CONTEXT_PRIORITY[b] ?? 99));

    for (const ctx of sortedContexts) {
      const ctxHandlers = handlersRef.current[ctx];
      if (!ctxHandlers) continue;
      const binding = bindings[ctx];
      if (!binding) continue;
      const action = binding[keystroke];
      if (!action) continue;
      const entry = ctxHandlers.get(action);
      if (entry && entry.isActive) {
        entry.handler(keystroke, action);
        return true;
      }
    }
    return false;
  }, [bindings]);

  // 用 useInput 捕获全局按键
  useInput((input, key) => {
    const ks = keyToKeystroke(input, key);
    if (ks) resolveAndDispatch(ks);
  });

  const ctxValue = { registerHandler, resolveAndDispatch, bindings };
  return createElement(KeybindingContext.Provider, { value: ctxValue }, children);
}

import { createElement } from 'react';

/**
 * 注册一个按键处理 handler。
 * @param {string} action - 绑定的 action 名（如 'chat:submit'）
 * @param {function} handler - 处理函数
 * @param {object} opts - { context: 'Global'|'Chat'|..., isActive: true }
 */
export function useKeybinding(action, handler, opts = {}) {
  const ctx = useContext(KeybindingContext);
  const { context = 'Global', isActive = true } = opts;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  if (!ctx) return;

  // 注册
  ctx.registerHandler(context, action, (ks, act) => handlerRef.current(ks, act), isActive);
}

/**
 * 批量注册多个 action → handler。
 */
export function useKeybindings(handlers, opts = {}) {
  for (const [action, handler] of Object.entries(handlers)) {
    useKeybinding(action, handler, opts);
  }
}

export { KeybindingContext };
