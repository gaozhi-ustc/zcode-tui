import { test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBaseline } from './baseline.js';

const DIR = fileURLToPath(new URL('../baselines/', import.meta.url));
const SELFTEST_FILE = join(DIR, 'unit-selftest.json');

// unit-selftest.json 是测试生成的临时产物，不纳入版本库；
// 跑前清理确保"首次运行自动建基线"路径被真实执行，跑后清理避免污染工作区。
beforeAll(() => rmSync(SELFTEST_FILE, { force: true }));
afterAll(() => rmSync(SELFTEST_FILE, { force: true }));

test('checkBaseline 首次运行自动建基线且不失败', () => {
  checkBaseline('unit-selftest', { frameCount: 7, fps: 3.5 });
  const saved = JSON.parse(readFileSync(join(DIR, 'unit-selftest.json'), 'utf8'));
  expect(saved.frameCount).toBe(7);
});

test('checkBaseline 未超基线×1.2 通过，超出则失败', () => {
  checkBaseline('unit-selftest', { frameCount: 8, fps: 3.9 }); // ≤ 7×1.2 / 3.5×1.2
  expect(() => checkBaseline('unit-selftest', { frameCount: 100 })).toThrow();
});

test('checkBaseline 忽略非数字与未知 key', () => {
  checkBaseline('unit-selftest', { frameCount: 7, note: '忽略我', newKey: 1 });
});
