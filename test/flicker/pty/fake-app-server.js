// 行分隔 JSON-RPC 假 app-server。用法: node fake-app-server.js <scenario>
// 应答 session/create + session/subscribe，随后按场景时间线推送事件。
import readline from 'node:readline';

const scenario = process.argv[2] || 'p1-stream';
const rl = readline.createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function notify(type, payload) {
  send({ jsonrpc: '2.0', method: 'session/event', params: { type, payload } });
}

function runScenario() {
  if (scenario === 'p1-stream') {
    notify('turn.started', { turnNumber: 1 });
    let i = 0;
    const timer = setInterval(() => {
      notify('model.streaming', { kind: 'text_delta', delta: '词', assistantMessageId: 'm1' });
      if (++i >= 100) {
        clearInterval(timer);
        notify('turn.completed', { turnNumber: 1 });
        setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 1000);
      }
    }, 5);
  } else if (scenario === 'p2-overflow') {
    notify('turn.started', { turnNumber: 1 });
    const longText = Array.from({ length: 60 }, (_, i) => `LINE-${i}`).join('\n');
    notify('model.streaming', { kind: 'text_delta', delta: longText, assistantMessageId: 'm1' });
    notify('turn.completed', { turnNumber: 1 });
    setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 1000);
  } else if (scenario === 'p3-resize') {
    notify('turn.started', { turnNumber: 1 });
    setTimeout(() => {
      notify('turn.completed', { turnNumber: 1 });
      setTimeout(() => process.stderr.write('SCENARIO_DONE\n'), 500);
    }, 4000);
  }
}

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'session/create') {
    send({ jsonrpc: '2.0', id: msg.id, result: { session: { sessionId: 'pty_sess' } } });
  } else if (msg.method === 'session/subscribe') {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
    setTimeout(runScenario, 300);
  } else if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
