# ZCode SSH TUI 前端 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个轻量终端 UI,通过 `app-server` 协议接入 ZCode CLI 引擎,让 ssh 用户在命令行获得完整 agent 体验。

**Architecture:** Node.js 应用。`ZCodeClient`(协议层)spawn `app-server` 子进程,用行分隔的 JSON-RPC(`{id, method, params}`)通信,接收 `state.updated`/`session/event` 流式事件。`Tui`(渲染层,基于 ink)消费事件渲染界面、捕获用户输入回传 `session/send`。`main.js` 串联两者,`setup-cli-config` 确保配置就绪,wrapper 脚本安装到 `~/.local/bin/zcode`。

**Tech Stack:** Node.js v24、ink 7(终端 UI)、vitest(测试)、原生 child_process + readline(协议)。

**已验证的关键事实(实现依据):**
- `node /opt/ZCode/resources/glm/zcode.cjs -p "..."` 单次模式已可用(cli/config.json 已配好)
- `app-server` 协议:消息 `{id, method, params}`,无 `jsonrpc` 字段(`.strict()` 校验)
- `session/create` params: `{workspace:{workspaceKey, workspacePath}}` → result 含 `session.sessionId`
- `session/subscribe` params: `{sessionId, deliveryKind:"desktop-continuous"}`
- `session/send` params: `{sessionId, content}`(字段是 `content` 不是 `message`)
- 事件流:`state.updated`(params.patch 状态变更)、`session/event`(params.payload 含 turnNumber/input/content/response/assistantMessageId)

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | 依赖(ink、vitest)、脚本 |
| `src/zcode-client.js` | 协议层:spawn app-server、JSON-RPC、事件分发(单一职责:通信) |
| `src/setup-cli-config.js` | 配置桥接:从 v2 config 生成 cli/config.json(单一职责:配置) |
| `src/tui/App.js` | ink 根组件:布局、状态管理 |
| `src/tui/MessageList.js` | 渲染对话历史 + 流式增量 |
| `src/tui/InputBox.js` | 输入框:捕获键入、斜杠命令 |
| `src/tui/StatusBar.js` | 状态栏:模型/模式/sessionId |
| `src/main.js` | 入口:串联 client + tui,生命周期管理 |
| `src/zcode-wrapper.sh` | 安装到 ~/.local/bin/zcode 的 wrapper |
| `test/zcode-client.test.js` | 协议层测试(模拟 app-server) |
| `test/setup-cli-config.test.js` | 配置桥接测试 |
| `test/tui/*.test.js` | 渲染层测试 |

---

## Task 1: 项目初始化与依赖

**Files:**
- Create: `package.json`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "zcode-ssh-tui",
  "version": "0.1.0",
  "type": "module",
  "description": "Terminal UI frontend for ZCode, usable over ssh",
  "bin": { "zcode-tui": "src/main.js" },
  "scripts": {
    "start": "node src/main.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "ink": "^7.1.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "ink-testing-library": "^4.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `cd /home/gaozhi/ZCodeProject && npm install`
Expected: node_modules 创建,无错误

- [ ] **Step 3: 验证 vitest 可跑**

Create `test/sanity.test.js`:
```js
import { test, expect } from 'vitest';
test('sanity', () => { expect(1 + 1).toBe(2); });
```
Run: `npx vitest run`
Expected: 1 test passed

- [ ] **Step 4: 删除 sanity 测试,提交**

Run: `rm test/sanity.test.js && git add -A && git commit -m "chore: 项目初始化与依赖"`

---

## Task 2: 配置桥接模块

**Files:**
- Create: `src/setup-cli-config.js`
- Test: `test/setup-cli-config.test.js`

**职责:** 读 `~/.zcode/v2/config.json`,提取 enabled provider,生成 `~/.zcode/cli/config.json`。

- [ ] **Step 1: 写失败测试**

`test/setup-cli-config.test.js`:
```js
import { test, expect } from 'vitest';
import { buildCliConfig } from '../src/setup-cli-config.js';

test('buildCliConfig 从 v2 config 生成正确 cli config', () => {
  const v2Config = {
    provider: {
      'builtin:bigmodel-coding-plan': {
        name: 'Bigmodel - Coding Plan',
        kind: 'anthropic',
        enabled: true,
        options: { baseURL: 'https://open.bigmodel.cn/api/anthropic', apiKey: 'KEY123' },
        models: { 'GLM-5.2': { limit: { context: 1000000 } } }
      },
      'builtin:disabled-one': { enabled: false, options: { apiKey: 'X' } }
    }
  };
  const result = buildCliConfig(v2Config);
  expect(result.model).toBe('builtin:bigmodel-coding-plan/GLM-5.2');
  expect(result.provider['builtin:bigmodel-coding-plan'].options.apiKey).toBe('KEY123');
  expect(result.provider['builtin:bigmodel-coding-plan'].options.baseURL).toBe('https://open.bigmodel.cn/api/anthropic');
  expect(result.provider['builtin:bigmodel-coding-plan'].kind).toBe('anthropic');
  // disabled provider 不应出现
  expect(result.provider['builtin:disabled-one']).toBeUndefined();
});

test('buildCliConfig 选第一个 enabled provider 的第一个 model', () => {
  const v2Config = {
    provider: {
      'p1': { enabled: true, kind: 'anthropic', options: { apiKey: 'K' }, models: { 'Alpha': {}, 'Beta': {} } }
    }
  };
  const result = buildCliConfig(v2Config);
  expect(result.model).toBe('p1/Alpha');
});

test('buildCliConfig 无 enabled provider 时抛错', () => {
  const v2Config = { provider: { 'p1': { enabled: false } } };
  expect(() => buildCliConfig(v2Config)).toThrow(/no enabled provider/i);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/setup-cli-config.test.js`
Expected: FAIL — 模块不存在 / 导入失败

- [ ] **Step 3: 实现**

`src/setup-cli-config.js`:
```js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 从 v2 config 对象构造 cli config 对象。
 * @param {object} v2Config - ~/.zcode/v2/config.json 的内容
 * @returns {{model: string, provider: object}} cli config
 * @throws {Error} 没有 enabled provider 时
 */
export function buildCliConfig(v2Config) {
  const providers = v2Config.provider || {};
  // 找第一个 enabled provider,保证顺序用 Object.entries
  const enabled = Object.entries(providers).find(([, p]) => p && p.enabled);
  if (!enabled) throw new Error('no enabled provider found in v2 config');
  const [providerId, provider] = enabled;
  const modelIds = Object.keys(provider.models || {});
  if (modelIds.length === 0) throw new Error(`provider ${providerId} has no models`);
  const modelId = modelIds[0];
  return {
    model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: {
        name: provider.name,
        kind: provider.kind,
        options: {
          baseURL: provider.options?.baseURL,
          apiKey: provider.options?.apiKey
        },
        enabled: true
      }
    }
  };
}

/** 确保 cli/config.json 就绪;已存在且含 model 字段则跳过。幂等。 */
export function ensureCliConfig() {
  const cliDir = join(homedir(), '.zcode', 'cli');
  const cliConfigPath = join(cliDir, 'config.json');
  if (existsSync(cliConfigPath)) {
    try {
      const existing = JSON.parse(readFileSync(cliConfigPath, 'utf8'));
      if (existing.model && existing.provider) return cliConfigPath; // 已就绪
    } catch { /* 文件损坏,重建 */ }
  }
  const v2Path = join(homedir(), '.zcode', 'v2', 'config.json');
  if (!existsSync(v2Path)) throw new Error(`v2 config not found at ${v2Path}; cannot bridge. Run ZCode GUI once first.`);
  const v2Config = JSON.parse(readFileSync(v2Path, 'utf8'));
  const cliConfig = buildCliConfig(v2Config);
  mkdirSync(cliDir, { recursive: true });
  writeFileSync(cliConfigPath, JSON.stringify(cliConfig, null, 2));
  return cliConfigPath;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/setup-cli-config.test.js`
Expected: 3 tests passed

- [ ] **Step 5: 提交**

Run: `git add -A && git commit -m "feat: 配置桥接模块 — 从 v2 config 生成 cli config"`

---

## Task 3: 协议客户端 — 消息收发骨架

**Files:**
- Create: `src/zcode-client.js`
- Test: `test/zcode-client.test.js`

**职责:** spawn app-server,逐行读写 JSON,按 id 匹配请求/响应,无 id 的消息作为事件分发。本任务只做骨架(连接、send 方法、id 匹配、断开),事件具体类型留 Task 4。

- [ ] **Step 1: 写失败测试(用模拟 server)**

`test/zcode-client.test.js`:
```js
import { test, expect, afterEach } from 'vitest';
import { ZCodeClient } from '../src/zcode-client.js';
import { spawn } from 'node:child_process';
import { once, EventEmitter } from 'node:events';

// 模拟 app-server:一个读 stdin 写 stdout 的 node 脚本
const MOCK_SERVER = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'session/list') {
    process.stdout.write(JSON.stringify({id: msg.id, result: {sessions: [{sessionId: 'sess_mock'}]}}) + '\\n');
  }
  // 不识别的方法回错误
  else if (msg.method) {
    process.stdout.write(JSON.stringify({id: msg.id, error: {code: -32601, message: 'mock: ' + msg.method}}) + '\\n');
  }
});
`;

let clients = [];
afterEach(async () => {
  for (const c of clients) await c.disconnect().catch(() => {});
  clients = [];
});

test('connect 启动子进程并就绪', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  expect(c.isConnected()).toBe(true);
});

test('send 按 id 匹配响应', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  const result = await c.send('session/list', {});
  expect(result.sessions[0].sessionId).toBe('sess_mock');
});

test('send 收到 error 时 reject', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', MOCK_SERVER] });
  clients.push(c);
  await c.connect();
  await expect(c.send('unknown/method', {})).rejects.toMatchObject({ code: -32601 });
});

test('子进程退出后 send 立即 reject', async () => {
  const c = new ZCodeClient({ command: 'node', args: ['-e', 'process.exit(0)'] });
  clients.push(c);
  await c.connect();
  await expect(c.send('session/list', {})).rejects.toThrow();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/zcode-client.test.js`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现**

`src/zcode-client.js`:
```js
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';

const DEFAULT_CMD = 'node';
const DEFAULT_ARGS = ['/opt/ZCode/resources/glm/zcode.cjs', 'app-server'];

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
      // stdout 第一次出现即视为就绪
      this.proc.stdout.once('data', () => resolve());
      // 兜底:若进程立刻退出
      this.proc.once('exit', () => {
        if (this._nextId === 0) reject(new Error('app-server exited before ready'));
      });
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/zcode-client.test.js`
Expected: 4 tests passed

- [ ] **Step 5: 提交**

Run: `git add -A && git commit -m "feat: 协议客户端骨架 — spawn/send/id 匹配/断开"`

---

## Task 4: 协议客户端 — 会话与事件语义

**Files:**
- Modify: `src/zcode-client.js`
- Modify: `test/zcode-client.test.js`

**职责:** 在骨架上加语义方法 `createSession`、`subscribe`、`sendMessage`,并把 `session/event`、`state.updated` 解析成结构化高层事件。

- [ ] **Step 1: 写失败测试(高层 API + 事件解析)**

追加到 `test/zcode-client.test.js`:
```js
import { parseEvent } from '../src/zcode-client.js';

test('parseEvent 把 state.updated 解析为 state 事件', () => {
  const raw = { method: 'state.updated', params: { patch: { status: 'running' }, sessionId: 's1', scope: 'session' } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('state');
  expect(parsed.patch.status).toBe('running');
});

test('parseEvent 把 session/event 含 content 解析为 text 事件', () => {
  const raw = { method: 'session/event', params: { payload: { content: 'pong', querySource: 'main_turn' } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('text');
  expect(parsed.text).toBe('pong');
});

test('parseEvent 把 session/event 含 response 解析为 turn-complete', () => {
  const raw = { method: 'session/event', params: { payload: { response: 'done', turnNumber: 1 } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('turn-complete');
});

test('parseEvent 未知 payload 归类为 raw', () => {
  const raw = { method: 'session/event', params: { payload: { somethingNew: true } } };
  const parsed = parseEvent(raw);
  expect(parsed.type).toBe('raw');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/zcode-client.test.js`
Expected: 新 4 个测试 FAIL(parseEvent 不存在)

- [ ] **Step 3: 实现 parseEvent 与高层方法**

在 `src/zcode-client.js` 顶部导出 `parseEvent`,在 class 内加高层方法:

```js
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
```

class 内新增(放在 `disconnect` 前):
```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/zcode-client.test.js`
Expected: 8 tests passed (4 旧 + 4 新)

- [ ] **Step 5: 真实 app-server 集成验证**

Run(一次性手动):
```bash
node -e "
import('./src/zcode-client.js').then(async ({ZCodeClient}) => {
  const c = new ZCodeClient();
  c.on('event', m => console.log('EVT:', JSON.stringify(m).slice(0,120)));
  await c.connect();
  const sid = await c.createSession('/home/gaozhi/ZCodeProject');
  await c.subscribe(sid);
  await c.sendMessage(sid, '只回复:pong');
  setTimeout(()=>process.exit(0), 15000);
});
"
```
Expected: 打印 sessionId,并看到 EVT 事件流,其中包含 text: "pong"

- [ ] **Step 6: 提交**

Run: `git add -A && git commit -m "feat: 协议客户端 — 会话方法与事件解析"`

---

## Task 5: TUI 渲染层 — 组件骨架

**Files:**
- Create: `src/tui/StatusBar.js`, `src/tui/MessageList.js`, `src/tui/InputBox.js`, `src/tui/App.js`
- Test: `test/tui/App.test.js`

**职责:** 用 ink 实现聊天界面骨架:状态栏、消息列表、输入框。本任务只测纯渲染(给定 props 的输出),不接协议。

- [ ] **Step 1: 写失败测试**

`test/tui/App.test.js`:
```js
import { test, expect } from 'vitest';
import render from 'ink-testing-library';
import React from 'react';
import { StatusBar } from '../../src/tui/StatusBar.js';
import { MessageList } from '../../src/tui/MessageList.js';
import { InputBox } from '../../src/tui/InputBox.js';

test('StatusBar 渲染模型与模式', () => {
  const { lastFrame } = render(React.createElement(StatusBar, { model: 'GLM-5.2', mode: 'build', sessionId: 'sess_abc123', status: 'idle' }));
  expect(lastFrame()).toContain('GLM-5.2');
  expect(lastFrame()).toContain('build');
  expect(lastFrame()).toContain('sess_abc123');
});

test('MessageList 渲染对话条目', () => {
  const messages = [
    { role: 'user', text: '你好' },
    { role: 'assistant', text: '你好!有什么可以帮你?' }
  ];
  const { lastFrame } = render(React.createElement(MessageList, { messages }));
  const f = lastFrame();
  expect(f).toContain('你好');
  expect(f).toContain('有什么可以帮你');
});

test('InputBox 渲染提示符', () => {
  const { lastFrame } = render(React.createElement(InputBox, { onSubmit: () => {} }));
  expect(lastFrame()).toContain('>');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tui/App.test.js`
Expected: FAIL — 组件不存在

- [ ] **Step 3: 实现三个子组件**

`src/tui/StatusBar.js`:
```js
import React from 'react';
import { Text, Box } from 'ink';

export function StatusBar({ model, mode, sessionId, status }) {
  const shortId = sessionId ? sessionId.slice(0, 12) : 'no-session';
  return React.createElement(Box, { flexDirection: 'row', gap: 2 },
    React.createElement(Text, { bold: true, color: 'cyan' }, 'ZCode'),
    React.createElement(Text, { dimColor: true }, shortId),
    React.createElement(Text, null, `model: ${model || '?'}`),
    React.createElement(Text, null, `mode: ${mode || '?'}`),
    React.createElement(Text, { color: status === 'running' ? 'yellow' : 'green' }, status || 'idle')
  );
}
```

`src/tui/MessageList.js`:
```js
import React from 'react';
import { Text, Box } from 'ink';

export function MessageList({ messages }) {
  const items = (messages || []).map((m, i) => {
    if (m.role === 'user') return React.createElement(Text, { key: i, color: 'green' }, `user: ${m.text}`);
    if (m.role === 'tool') return React.createElement(Text, { key: i, dimColor: true }, `  [tool] ${m.name}: ${m.text}`);
    if (m.role === 'error') return React.createElement(Text, { key: i, color: 'red' }, `error: ${m.text}`);
    return React.createElement(Text, { key: i }, `assistant: ${m.text}`);
  });
  return React.createElement(Box, { flexDirection: 'column' }, ...items);
}
```

`src/tui/InputBox.js`:
```js
import React, { useState } from 'react';
import { TextInput, Text, Box } from 'ink';

export function InputBox({ onSubmit }) {
  const [value, setValue] = useState('');
  return React.createElement(Box, { flexDirection: 'row' },
    React.createElement(Text, { color: 'cyan' }, '> '),
    React.createElement(TextInput, {
      value,
      onChange: setValue,
      onSubmit: (v) => { if (v.trim()) { onSubmit(v); setValue(''); } }
    })
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tui/App.test.js`
Expected: 3 tests passed

- [ ] **Step 5: 提交**

Run: `git add -A && git commit -m "feat: TUI 组件骨架 — StatusBar/MessageList/InputBox"`

---

## Task 6: TUI 根组件 — 状态与事件接入

**Files:**
- Create: `src/tui/App.js`
- Modify: `test/tui/App.test.js`

**职责:** App 组件持有状态(messages、status、model、mode),接收一个 `client` prop,绑定事件 → setState,用户提交 → sendMessage。

- [ ] **Step 1: 写失败测试(用 mock client 验证交互)**

追加到 `test/tui/App.test.js`:
```js
import { App } from '../../src/tui/App.js';

function makeMockClient() {
  const handlers = {};
  return {
    on: (evt, fn) => { handlers[evt] = fn; },
    _emit: (evt, data) => handlers[evt] && handlers[evt](data),
    sendMessage: async () => 'ok',
    createSession: async () => 'sess_test',
    subscribe: async () => 'ok',
    isConnected: () => true
  };
}

test('App 渲染并发送用户输入', async () => {
  const client = makeMockClient();
  let sent = null;
  client.sendMessage = async (sid, content) => { sent = content; };
  const { lastFrame, stdin } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  // 输入文字并回车
  stdin.write('hello world');
  stdin.write('\r');
  await new Promise(r => setTimeout(r, 50));
  expect(sent).toBe('hello world');
});

test('App 收到 text 事件追加 assistant 消息', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'text', text: 'pong' });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('pong');
});

test('App 收到 state 事件更新状态栏', async () => {
  const client = makeMockClient();
  const { lastFrame } = render(React.createElement(App, { client, sessionId: 'sess_test' }));
  client._emit('event', { type: 'state', patch: { status: 'running' } });
  await new Promise(r => setTimeout(r, 50));
  expect(lastFrame()).toContain('running');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/tui/App.test.js`
Expected: 新 3 个 FAIL(App 不存在)

- [ ] **Step 3: 实现 App**

`src/tui/App.js`:
```js
import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { StatusBar } from './StatusBar.js';
import { MessageList } from './MessageList.js';
import { InputBox } from './InputBox.js';
import { parseEvent } from '../zcode-client.js';

export function App({ client, sessionId }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle');
  const [model, setModel] = useState('GLM-5.2');
  const [mode, setMode] = useState('build');
  const { exit } = useApp();

  useEffect(() => {
    const onEvent = (raw) => {
      const evt = parseEvent(raw);
      if (evt.type === 'state') {
        if (evt.patch?.status) setStatus(evt.patch.status);
        if (evt.patch?.mode?.current) setMode(evt.patch.mode.current);
        if (evt.patch?.model?.current?.modelId) setModel(evt.patch.model.current.modelId);
      } else if (evt.type === 'text') {
        setMessages(prev => [...prev, { role: 'assistant', text: evt.text, mid: evt.assistantMessageId }]);
      } else if (evt.type === 'turn-complete') {
        setStatus('idle');
      } else if (evt.type === 'permission') {
        // 第一版:工具调用默认放行(build 模式下 agent 内部已处理),这里仅记录
        setMessages(prev => [...prev, { role: 'tool', name: 'permission', text: 'requested' }]);
      }
    };
    client.on('event', onEvent);
    return () => client.removeListener('event', onEvent);
  }, [client]);

  useInput((input, key) => {
    if (input === '\x03') exit(); // Ctrl+C
  });

  const handleSubmit = async (text) => {
    setMessages(prev => [...prev, { role: 'user', text }]);
    if (text.startsWith('/')) {
      // 斜杠命令第一版:只支持 /quit
      if (text.trim() === '/quit') exit();
      return;
    }
    try { await client.sendMessage(sessionId, text); }
    catch (e) { setMessages(prev => [...prev, { role: 'error', text: e.message }]); }
  };

  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(StatusBar, { model, mode, sessionId, status }),
    React.createElement(MessageList, { messages }),
    React.createElement(InputBox, { onSubmit: handleSubmit }),
    React.createElement(Text, { dimColor: true }, '[Ctrl+C] quit  [/quit] quit')
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/tui/App.test.js`
Expected: 6 tests passed (3 旧 + 3 新)

- [ ] **Step 5: 提交**

Run: `git add -A && git commit -m "feat: TUI 根组件 — 事件接入与用户交互"`

---

## Task 7: 主入口与生命周期

**Files:**
- Create: `src/main.js`

**职责:** 串联配置桥接 + client + ink render。处理 Ctrl+C 优雅退出。

- [ ] **Step 1: 实现 main.js**

`src/main.js`:
```js
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { ensureCliConfig } from './setup-cli-config.js';
import { ZCodeClient } from './zcode-client.js';
import { App } from './tui/App.js';

async function main() {
  // 1. 确保配置就绪
  try { ensureCliConfig(); }
  catch (e) {
    console.error(`配置错误: ${e.message}`);
    console.error('请先运行 ZCode GUI 登录一次,或手动配置 ~/.zcode/cli/config.json');
    process.exit(1);
  }

  // 2. 确定 workspace
  const workspace = process.env.ZCODE_TUI_CWD || process.cwd();

  // 3. 连接 app-server
  const client = new ZCodeClient();
  try { await client.connect(); }
  catch (e) { console.error(`无法启动 app-server: ${e.message}`); process.exit(1); }

  // 4. 建会话
  let sessionId;
  try { sessionId = await client.createSession(workspace); }
  catch (e) { console.error(`创建会话失败: ${JSON.stringify(e)}`); await client.disconnect(); process.exit(1); }
  await client.subscribe(sessionId);

  // 5. 渲染 TUI
  const instance = render(React.createElement(App, { client, sessionId }));

  // 6. 退出清理
  const cleanup = async () => { instance.unmount(); await client.disconnect(); process.exit(0); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  client.on('exit', () => { console.error('app-server 意外退出'); process.exit(1); });
}

main();
```

- [ ] **Step 2: 手动冒烟测试(交互式 ssh 终端)**

在真实交互式 ssh 终端(非 agent 执行环境)运行:
```bash
cd /home/gaozhi/ZCodeProject
node src/main.js
```
Expected: 出现界面,键入"只回复:pong"回车,几秒后显示 assistant: pong,Ctrl+C 退出

- [ ] **Step 3: 提交**

Run: `git add -A && git commit -m "feat: 主入口 — 串联配置/client/TUI,生命周期管理"`

---

## Task 8: Wrapper 与安装

**Files:**
- Create: `src/zcode-wrapper.sh`
- Create: `README.md`

**职责:** wrapper 安装到 `~/.local/bin/zcode`,处理 TERM 检测、逃生舱。README 说明安装与使用。

- [ ] **Step 1: 实现 wrapper**

`src/zcode-wrapper.sh`:
```bash
#!/usr/bin/env bash
# zcode-ssh-tui wrapper — 把 shell 里的 zcode 路由到自建 TUI
set -euo pipefail

PROJECT_DIR="/home/gaozhi/ZCodeProject"

# 逃生舱:显式要原生 CLI
if [ "${ZCODE_CLI_LEGACY:-0}" = "1" ]; then
  exec node /opt/ZCode/resources/glm/zcode.cjs "$@"
fi

# 非 TUI 或 dumb 终端:降级提示
if [ ! -t 0 ] || [ ! -t 1 ] || [ "${TERM:-}" = "dumb" ]; then
  echo "zcode: 当前终端不支持全屏 TUI (TERM=${TERM:-unset}, 非 TTY)。" >&2
  echo "  用单次模式: node /opt/ZCode/resources/glm/zcode.cjs -p \"你的问题\"" >&2
  echo "  或在交互式 ssh 会话(分配伪终端)里运行。" >&2
  exit 1
fi

exec node "${PROJECT_DIR}/src/main.js" "$@"
```

- [ ] **Step 2: 安装到 ~/.local/bin**

Run:
```bash
chmod +x src/zcode-wrapper.sh
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode
```
验证 `~/.local/bin` 在 PATH 中且优先于 /usr/bin:
```bash
which -a zcode | head -1
```
Expected: `/home/gaozhi/.local/bin/zcode`

- [ ] **Step 3: 写 README**

`README.md`:
````markdown
# zcode-ssh-tui

让 ZCode 在 ssh 终端里可用的轻量 TUI 前端。通过 `app-server` 协议复用 ZCode CLI 引擎的全部 agent 能力(LLM、工具、任务规划)。

## 前置条件

- ZCode GUI 已安装且至少登录运行过一次(用于生成 v2 config 与 apiKey)
- Node.js v18+

## 安装

```bash
cd /home/gaozhi/ZCodeProject
npm install
mkdir -p ~/.local/bin
cp src/zcode-wrapper.sh ~/.local/bin/zcode
chmod +x ~/.local/bin/zcode
```

确保 `~/.local/bin` 在 PATH 靠前位置(bash 默认满足)。

## 使用

ssh 登录后,在任意项目目录:
```bash
zcode
```
进入交互式 TUI。键入消息回车发送,`Ctrl+C` 或 `/quit` 退出。

单次模式(脚本/管道):
```bash
node /opt/ZCode/resources/glm/zcode.cjs -p "你的问题"
```

逃生舱(临时用原生 CLI,绕过 TUI):
```bash
ZCODE_CLI_LEGACY=1 zcode --help
```

## 配置说明

本工具读 `~/.zcode/cli/config.json`(与 GUI 的 `~/.zcode/v2/config.json` 独立)。首次运行自动从 v2 config 桥接生成。更换模型/provider 后删除 `~/.zcode/cli/config.json` 重跑即可重建。

## 故障排查

| 现象 | 解决 |
|---|---|
| `Model config is missing` | 运行 GUI 登录一次;或删除 `~/.zcode/cli/config.json` 重跑 |
| `missing baseURL/apiKey` | 检查 v2 config 的 provider.options 字段完整 |
| 终端渲染错乱 | 确认 TERM 不是 dumb;推荐 xterm-256color / kitty / WezTerm |
````

- [ ] **Step 4: 提交**

Run: `git add -A && git commit -m "feat: wrapper 与 README — 安装到 PATH,使用说明"`

---

## Task 9: 端到端验证

**Files:** 无新文件(验证任务)

- [ ] **Step 1: 完整单元测试套件**

Run: `cd /home/gaozhi/ZCodeProject && npx vitest run`
Expected: 全部测试通过(zcode-client 8 + setup-config 3 + tui 6 = 17)

- [ ] **Step 2: ssh 会话端到端冒烟(手动)**

在真实交互式 ssh 终端:
```bash
cd /home/gaozhi/ZCodeProject
zcode
```
验证清单:
- [ ] 界面正常渲染(状态栏 + 输入框)
- [ ] 输入"只回复:pong"→ 看到 assistant: pong
- [ ] 输入"在 /tmp 创建一个文件 hi.txt 内容写 hello"→ 看到 tool 调用提示,且 /tmp/hi.txt 被创建
- [ ] Ctrl+C 正常退出,无残留进程

- [ ] **Step 3: 降级路径验证**

在非 TTY 环境(agent 或管道):
```bash
echo "" | zcode
```
Expected: 打印降级提示并 exit 1,不崩溃

- [ ] **Step 4: 最终提交**

Run: `git add -A && git commit -m "test: 端到端验证通过" --allow-empty`

---

## Self-Review 自检结果

(实现阶段执行完毕后填写,此处为计划阶段预占位)

- **Spec coverage:** 配置桥接✓(T2)、协议✓(T3/T4)、TUI✓(T5/T6)、入口✓(T7)、安装✓(T8)、验证✓(T9)。permission 响应在 T4 留 stub,T6 记录显示——第一版可接受(默认模式 yolo 下 agent 自决)。
- **Placeholder scan:** 无 TBD/TODO;每步有完整代码或确切命令。
- **Type consistency:** `sessionId` 来自 `result.session.sessionId`(T4),App/Config 调用一致;`sendMessage(sessionId, content)` 全程一致。
