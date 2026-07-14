import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

const DEFAULT_CMD = 'node';
const DEFAULT_ARGS = ['/opt/ZCode/resources/glm/zcode.cjs', 'app-server'];

/** 把原始 server 消息解析为高层事件对象。 */
export function parseEvent(raw) {
  if (raw.method === 'state.updated') {
    return { type: 'state', patch: raw.params.patch, sessionId: raw.params.sessionId, scope: raw.params.scope };
  }
  if (raw.method === 'session/event') {
    const p = raw.params.payload || {};
    if (p.content != null && p.querySource) return { type: 'text', text: p.content, querySource: p.querySource, assistantMessageId: p.assistantMessageId };
    if (p.response != null) return { type: 'turn-complete', response: p.response, turnNumber: p.turnNumber };
    if (p.input != null) return { type: 'turn-start', input: p.input, turnNumber: p.turnNumber };
    return { type: 'raw', payload: p };
  }
  if (raw.method === 'interaction/requestPermission') {
    return { type: 'permission', requestId: raw.params?.requestId, ...raw.params };
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

  /** 发送请求,返回 Promise(result)。error 则 reject。 */
  send(method, params = {}) {
    if (this._closed) return Promise.reject(new Error('client disconnected'));
    const id = ++this._nextId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  /** 处理子进程的一行输出。 */
  _onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; } // 非 JSON 忽略
    if (msg.id != null && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    } else {
      // 无匹配 id → 事件/通知(method 字段存在)
      if (msg.method) this.emit('event', msg);
    }
  }

  _rejectAll(err) {
    for (const { reject } of this._pending.values()) reject(err);
    this._pending.clear();
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

  /** 发送用户消息(content 字段,非 message)。 */
  async sendMessage(sessionId, content) {
    return this.send('session/send', { sessionId, content });
  }

  /** 响应权限请求。 */
  async respondPermission(requestId, decision) {
    return this.send('interaction/respondPermission', { requestId, decision });
  }

  /** 中断当前会话的运行中 turn（对应 Ctrl+C 中断）。 */
  async stop(sessionId) {
    return this.send('session/stop', { sessionId });
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
