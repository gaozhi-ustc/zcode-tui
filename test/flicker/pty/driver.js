// 在真实 pty 中渲染 App，连接 fake-app-server。用法: node driver.js <scenario>
import React from 'react';
import { execSync } from 'node:child_process';
import { render } from 'ink';
import { App } from '../../../src/tui/App.js';
import { ZCodeClient } from '../../../src/zcode-client.js';

const scenario = process.argv[2] || 'p1-stream';
const serverPath = new URL('./fake-app-server.js', import.meta.url).pathname;

const client = new ZCodeClient({ command: process.execPath, args: [serverPath, scenario] });
await client.connect();
const sessionId = await client.createSession(process.cwd());
await client.subscribe(sessionId);

render(React.createElement(App, { client, sessionId }), { exitOnCtrlC: false });

if (scenario === 'p3-resize') {
  // /dev/tty 即 script(1) 分配的 pty；stty 改尺寸触发 SIGWINCH
  setTimeout(() => { try { execSync('stty cols 80 < /dev/tty'); } catch {} }, 1500);
  setTimeout(() => { try { execSync('stty cols 100 < /dev/tty'); } catch {} }, 3000);
}
