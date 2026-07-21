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

/** 确保 cli/config.json 就绪;已存在且含 model 字段则跳过。幂等。
 *  无 GUI 兜底：cli config 直接用（login/config 命令生成的也行），不强制要求 v2 config。
 */
export function ensureCliConfig() {
  const cliDir = join(homedir(), '.zcode', 'cli');
  const cliConfigPath = join(cliDir, 'config.json');
  // 1. cli config 已存在且有效 → 直接用（支持 zcode login / zcode config --apikey 生成的）
  if (existsSync(cliConfigPath)) {
    try {
      const existing = JSON.parse(readFileSync(cliConfigPath, 'utf8'));
      if (existing.model && existing.provider) {
        // 额外校验 apiKey 非空
        const prov = Object.values(existing.provider)[0];
        if (prov?.options?.apiKey) return cliConfigPath;
      }
    } catch { /* 文件损坏,重建 */ }
  }
  // 2. v2 config 存在 → 桥接（GUI 安装的机器）
  const v2Path = join(homedir(), '.zcode', 'v2', 'config.json');
  if (existsSync(v2Path)) {
    try {
      const v2Config = JSON.parse(readFileSync(v2Path, 'utf8'));
      const cliConfig = buildCliConfig(v2Config);
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(cliConfigPath, JSON.stringify(cliConfig, null, 2));
      return cliConfigPath;
    } catch (e) { /* 桥接失败，继续到提示 */ }
  }
  // 3. 都不存在 → 提示用户运行 login 或 config
  throw new Error(
    '配置缺失。请运行以下任一命令配置：\n' +
    '  zcode login          # 浏览器登录 z.ai\n' +
    '  zcode config --apikey <key>  # 直接设置 API Key'
  );
}
