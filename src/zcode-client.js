import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

const DEFAULT_CMD = 'node';
const DEFAULT_ARGS = ['/opt/ZCode/resources/glm/zcode.cjs', 'app-server'];

/**
 * 把原始 server 消息解析为高层事件对象。
 *
 * 实机抓包确认的事件格式（2026-07-16）：
 * - session/event 的事件类型在 params.type（点号分隔，如 "model.streaming"）
 * - payload 在 params.payload
 * - 文本流式：model.streaming + payload.kind="text_delta"，文本在 payload.delta
 * - 工具调用：model.streaming(kind=tool_call/tool_input_*) + tool.updated(kind=scheduled/started/result)
 * - turn 生命周期：turn.started / turn.completed
 * - session 状态：session.updated（含 usage）
 */
export function parseEvent(raw) {
  if (raw.method === 'state.updated') {
    return { type: 'state', patch: raw.params.patch, sessionId: raw.params.sessionId, scope: raw.params.scope };
  }
  if (raw.method === 'session/event') {
    const eventType = raw.params?.type;
    const p = raw.params?.payload || {};

    switch (eventType) {
      // === Turn 生命周期 ===
      case 'turn.started':
        return { type: 'turn-start', input: p.input, turnNumber: p.turnNumber };
      case 'turn.completed':
        return { type: 'turn-complete', response: p.response, turnNumber: p.turnNumber, usage: p.usage, duration: p.duration };

      // === 文本 + 工具调用流式（统一 model.streaming，用 payload.kind 区分）===
      case 'model.streaming': {
        const kind = p.kind;
        // 文本增量
        if (kind === 'text_delta') {
          return { type: 'text', text: p.delta || '', assistantMessageId: p.assistantMessageId };
        }
        // 工具调用完整到达（含 input）
        if (kind === 'tool_call') {
          return { type: 'tool-call', toolName: p.toolName, toolInput: p.input, toolCallId: p.toolCallId, assistantMessageId: p.assistantMessageId };
        }
        // 工具输入流式片段（tool_input_start/delta/end）——当前忽略细节，tool_call 已含完整 input
        if (kind === 'tool_input_start') {
          return { type: 'tool-call', toolName: p.toolName, toolInput: {}, toolCallId: p.toolCallId, assistantMessageId: p.assistantMessageId };
        }
        // 其他 kind（tool_input_delta/end）忽略
        return { type: 'raw', eventType, kind, payload: p };
      }

      // === 工具状态更新（统一 tool.updated，用 payload.kind 区分阶段）===
      case 'tool.updated': {
        const kind = p.kind;
        if (kind === 'scheduled') {
          return { type: 'tool-call', toolName: p.toolName, toolInput: {}, toolCallId: p.toolCallId, phase: 'scheduled' };
        }
        if (kind === 'started') {
          return { type: 'tool-call', toolName: p.toolName, toolCallId: p.toolCallId, phase: 'started', startedAt: p.startedAt };
        }
        if (kind === 'result' || kind === 'error') {
          return { type: 'tool-result', toolCallId: p.toolCallId, toolName: p.toolName, result: p.result, error: p.result?.success === false, duration: p.duration };
        }
        if (kind === 'batch') {
          return { type: 'tool-batch-complete', successCount: p.successCount, errorCount: p.errorCount };
        }
        return { type: 'raw', eventType, kind, payload: p };
      }

      // === Session 状态更新（含 usage/token）===
      case 'session.updated': {
        // 有 usage 字段的 session.updated 是 turn 结束的统计
        if (p.usage) {
          return { type: 'usage', usage: p.usage, stopReason: p.stopReason, contextWindow: p.contextWindow };
        }
        // 有 model/modelRef 的是模型信息更新
        if (p.model || p.modelRef) {
          return { type: 'session-model', model: p.model, modelRef: p.modelRef, messageCount: p.messageCount, toolCount: p.toolCount };
        }
        return { type: 'raw', eventType, payload: p };
      }

      case 'session.titleUpdated':
        return { type: 'title-updated', title: p.title };

      case 'streamRecovery.updated':
        return { type: 'raw', eventType, payload: p };
    }

    return { type: 'raw', eventType, payload: p };
  }
  if (raw.method === 'interaction/requestPermission') {
    return { type: 'permission', requestId: raw.params?.requestId, ...raw.params };
  }
  if (raw.method === 'interaction/requestUserInput') {
    return { type: 'user-input-request', requestId: raw.params?.requestId, ...raw.params };
  }
  return { type: 'unknown', raw };
}

/**
 * ZCode app-server 协议客户端。
 * spawn 子进程,用行分隔 JSON-RPC({id, method, params})通信。
 */
export class ZCodeClient extends EventEmitter {
  constructor({ command = DEFAULT_CMD, args = DEFAULT_ARGS } = {}) {
    super();
    this.command = command;
    this.args = args;
    this.proc = null;
    this._nextId = 0;
    this._pending = new Map(); // id -> {resolve, reject}
    this._closed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'inherit'] });
      const rl = createInterface({ input: this.proc.stdout });
      rl.on('line', (line) => this._onLine(line));

      // stdin 写入已退出进程会触发 EPIPE,挂个空 handler 避免 unhandled error 崩溃
      this.proc.stdin.on('error', () => {});

      this.proc.on('error', (err) => {
        this._closed = true;
        this._rejectAll(new Error(`app-server spawn failed: ${err.message}`));
        reject(err);
      });
      this.proc.on('exit', (code) => {
        this._closed = true;
        this._rejectAll(new Error(`app-server exited with code ${code}`));
        this.emit('exit', code);
      });
      // app-server 是 stdio JSON-RPC,不在连接时发就绪 banner,
      // 因此以子进程成功 spawn 作为就绪信号(spawn 必在 exit/error 之前触发)。
      // spawn 前若发生错误,'error' 事件会 reject。
      this.proc.once('spawn', () => resolve());
    });
  }

  isConnected() { return !this._closed && this.proc && !this.proc.killed; }

  /**
   * 重连：重新 spawn app-server 子进程。
   * 用于 app-server 崩溃后恢复（session 持久化在 store 里，不丢失）。
   * 重连后需要重新 resume + subscribe。
   */
  async reconnect() {
    this._closed = false;
    this._pending.clear();
    this._nextId = 0;
    return this.connect();
  }

  /** 发送请求,返回 Promise(result)。error 则 reject。 */
  send(method, params = {}) {
    if (this._closed) return Promise.reject(new Error('client disconnected'));
    const id = ++this._nextId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  /**
   * 响应 server 发起的请求（如 interaction/requestPermission）。
   * server 向 client 发 {id, method, params}，client 用 {id, result} 回复。
   * @param {number} id - server 请求的 JSON-RPC id
   * @param {object} result - 响应结果
   */
  respondToServer(id, result) {
    if (this._closed) return;
    this.proc.stdin.write(JSON.stringify({ id, result }) + '\n');
  }

  /** 处理子进程的一行输出。 */
  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // 非 JSON 忽略
    // 1. client 请求的响应（id 在 _pending 里，有 result 或 error）
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
      return;
    }
    // 2. server 发起的请求（有 id + method + params）——需 client 响应
    if (msg.id != null && msg.method) {
      this.emit('server-request', msg);
      return;
    }
    // 3. server 的 notification/事件（无 id，有 method）
    if (msg.method) {
      this.emit('event', msg);
    }
  }

  _rejectAll(err) {
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
  }

  /** 获取可用模型列表（通过 workspace/readState 的 modelCatalog）。 */
  async getAvailableModels(workspacePath) {
    const ws = workspacePath || process.cwd();
    const result = await this.send('workspace/readState', {
      workspace: { workspaceKey: ws, workspacePath: ws }
    });
    return result?.modelCatalog?.available || [];
  }

  /** 创建会话,返回 sessionId。 */
  async createSession(workspacePath) {
    const result = await this.send('session/create', {
      workspace: { workspaceKey: workspacePath, workspacePath }
    });
    return result.session.sessionId;
  }

  /** 订阅会话事件流。 */
  async subscribe(sessionId) {
    return this.send('session/subscribe', { sessionId, deliveryKind: 'desktop-continuous' });
  }

  /** 发送用户消息(content 字段,非 message)。可选 runtimeModel 触发 restoreWarning 清除。 */
  async sendMessage(sessionId, content, runtimeModel = null) {
    const params = { sessionId, content };
    if (runtimeModel) params.runtimeModel = runtimeModel;
    return this.send('session/send', params);
  }

  /** 中断当前会话的运行中 turn（对应 Ctrl+C 中断）。 */
  async stop(sessionId) {
    return this.send('session/stop', { sessionId });
  }

  /** 列出所有会话（用于会话恢复）。 */
  async listSessions() {
    const result = await this.send('session/list');
    return result.sessions || result;
  }

  /** 恢复已有会话。 */
  async resumeSession(sessionId) {
    return this.send('session/resume', { sessionId });
  }

  /** 运行时切换模型。model 参数为 {providerId, modelId} 或 modelId 字符串。 */
  async setModel(sessionId, model) {
    // app-server 要求 model 是 {providerId, modelId} 对象
    const modelObj = typeof model === 'string' ? { providerId: '', modelId: model } : model;
    return this.send('session/setModel', { sessionId, model: modelObj });
  }

  /** 运行时切换权限模式。 */
  async setMode(sessionId, mode) {
    return this.send('session/setMode', { sessionId, mode });
  }

  /** 压缩对话上下文。 */
  async compact(sessionId) {
    return this.send('session/compact', { sessionId });
  }

  async disconnect() {
    this._closed = true;
    if (this.proc) {
      this.proc.kill('SIGTERM');
      await new Promise((r) => {
        const t = setTimeout(() => { this.proc.kill('SIGKILL'); r(); }, 2000);
        this.proc.once('exit', () => { clearTimeout(t); r(); });
      });
    }
  }
}
