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
