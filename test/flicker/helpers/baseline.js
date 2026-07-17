import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect } from 'vitest';

const BASELINE_DIR = fileURLToPath(new URL('../baselines/', import.meta.url));

/**
 * 基线快照断言：数字型度量 ≤ 基线 × tolerance。
 * 基线不存在时自动记录并直接通过；UPDATE_BASELINES=1 时重写全部基线。
 */
export function checkBaseline(name, metrics, { tolerance = 1.2 } = {}) {
  const file = join(BASELINE_DIR, `${name}.json`);
  const flat = Object.fromEntries(
    Object.entries(metrics).filter(([, v]) => typeof v === 'number'),
  );

  let baseline = null;
  try { baseline = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 不存在 */ }

  if (!baseline || process.env.UPDATE_BASELINES === '1') {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(flat, null, 2) + '\n');
    return;
  }

  for (const [key, value] of Object.entries(flat)) {
    if (!(key in baseline)) continue;
    const limit = baseline[key] * tolerance;
    expect(
      value,
      `[${name}] ${key}: 实测 ${value} 超过 基线 ${baseline[key]} × ${tolerance} = ${limit}`,
    ).toBeLessThanOrEqual(limit);
  }
}
