import { vi } from 'vitest';

/** 与 test/tui/App.test.js 同形的 mock client。 */
export function makeMockClient() {
  const handlers = {};
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    off: () => {},
    removeListener: () => {},
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    stop: async () => 'ok',
    respondToServer: () => {},
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true,
  };
}

/** 构造 session/event 原始 JSON-RPC notification（走 parseEvent 全路径）。 */
export function sessionEvent(type, payload) {
  return { jsonrpc: '2.0', method: 'session/event', params: { type, payload } };
}

/**
 * 流式事件编排器。链式声明场景，run() 按 fake timers 推进发射。
 * textDelta 的 everyMs>0 时逐条推进时钟（模拟真实 delta 到达节奏）。
 */
export function makeScript(client) {
  const steps = [];
  const api = {
    turnStart(n = 1) {
      steps.push({ kind: 'emit', raw: sessionEvent('turn.started', { turnNumber: n }) });
      return api;
    },
    textDelta(text, { repeat = 1, everyMs = 0, mid = 'm1' } = {}) {
      steps.push({
        kind: 'burst',
        make: () => sessionEvent('model.streaming', { kind: 'text_delta', delta: text, assistantMessageId: mid }),
        repeat, everyMs,
      });
      return api;
    },
    toolCall(toolName, input = {}, id = 't1') {
      steps.push({ kind: 'emit', raw: sessionEvent('model.streaming', { kind: 'tool_call', toolName, input, toolCallId: id }) });
      return api;
    },
    toolResult(id = 't1', result = { success: true, content: 'ok' }) {
      steps.push({ kind: 'emit', raw: sessionEvent('tool.updated', { kind: 'result', toolCallId: id, result }) });
      return api;
    },
    turnComplete(n = 1) {
      steps.push({ kind: 'emit', raw: sessionEvent('turn.completed', { turnNumber: n }) });
      return api;
    },
    permissionRequest(id = 42, toolName = 'Bash', input = { command: 'ls' }) {
      steps.push({
        kind: 'server-request',
        raw: { jsonrpc: '2.0', id, method: 'interaction/requestPermission', params: { toolName, input, reason: 'test', riskLevel: 'low' } },
      });
      return api;
    },
    async run() {
      for (const step of steps) {
        if (step.kind === 'emit') {
          client._emit('event', step.raw);
        } else if (step.kind === 'server-request') {
          client._emit('server-request', step.raw);
        } else if (step.kind === 'burst') {
          for (let i = 0; i < step.repeat; i++) {
            client._emit('event', step.make());
            if (step.everyMs > 0 && i < step.repeat - 1) {
              await vi.advanceTimersByTimeAsync(step.everyMs);
            }
          }
        }
      }
    },
  };
  return api;
}
