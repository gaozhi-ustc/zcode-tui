import { test, expect } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countFullClears, countEraseLineUps } from '../helpers/ansi-metrics.js';
import { checkBaseline } from '../helpers/baseline.js';

const DRIVER = fileURLToPath(new URL('./driver.js', import.meta.url));

const hasScript = (() => {
  try { execSync('which script', { stdio: 'pipe' }); return true; } catch { return false; }
})();
const runPty = process.env.RUN_PTY === '1' && hasScript;

function runScenario(scenario, { rows = 24, cols = 100, timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const cmd = `stty rows ${rows} cols ${cols}; node ${DRIVER} ${scenario}`;
    const proc = spawn('script', ['-qec', cmd, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('pty scenario timeout')); }, timeoutMs);
    const check = setInterval(() => {
      if (output.includes('SCENARIO_DONE')) {
        clearTimeout(timer);
        clearInterval(check);
        proc.kill('SIGKILL');
        resolve(output.split('SCENARIO_DONE')[0]);
      }
    }, 100);
    proc.on('error', (err) => { clearTimeout(timer); clearInterval(check); reject(err); });
  });
}

test.skipIf(!runPty)('P1: 流式突发的字节级擦除模式', async () => {
  const bytes = await runScenario('p1-stream');
  expect(countFullClears(bytes)).toBe(0);
  expect(bytes).toContain('词'.repeat(20));
  checkBaseline('p1-stream-pty', { eraseLinesTotal: countEraseLineUps(bytes), bytesTotal: bytes.length });
}, 30000);

test.skipIf(!runPty)('P2: 小窗溢出无死循环重写', async () => {
  const bytes = await runScenario('p2-overflow', { rows: 15 });
  expect(bytes).toContain('LINE-59');
  checkBaseline('p2-overflow-pty', {
    fullClearCount: countFullClears(bytes),
    eraseLinesTotal: countEraseLineUps(bytes),
    bytesTotal: bytes.length,
  });
}, 30000);

test.skipIf(!runPty)('P3: 运行中 resize 全清次数有界', async () => {
  const bytes = await runScenario('p3-resize', { rows: 24, cols: 100 });
  expect(countFullClears(bytes)).toBeLessThanOrEqual(2);
}, 30000);
