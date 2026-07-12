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
  // fail-fast:缺 baseURL/apiKey 会生成静默坏配置,后续报 "missing API key" 难排查
  const baseURL = provider.options?.baseURL;
  const apiKey = provider.options?.apiKey;
  if (!baseURL || !apiKey) {
    throw new Error(`provider ${providerId} is missing options.baseURL or options.apiKey in v2 config`);
  }
  const modelId = modelIds[0];
  return {
    model: `${providerId}/${modelId}`,
    provider: {
      [providerId]: {
        name: provider.name,
        kind: provider.kind,
        options: {
          baseURL,
          apiKey
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
