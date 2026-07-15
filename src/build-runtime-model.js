import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

/**
 * 构造完整的 runtimeModel 对象（y_ 类型），用于 session/send 的 runtimeModel 参数
 * 或 session/updateRuntimeModelConfig，触发 app-server 清除 restoreWarning。
 *
 * runtimeModel 需要完整的 provider 配置（含 baseURL/apiKey），这些敏感信息
 * 不在 workspace/readState 里，需要从 ~/.zcode/cli/config.json 读取。
 *
 * @param {object} client - ZCodeClient 实例
 * @param {string} sessionId
 * @param {string} workspacePath
 * @returns {Promise<object|null>} runtimeModel 对象，失败返回 null
 */
export async function buildRuntimeModel(client, workspacePath) {
  try {
    // 1. 从 cli config 读 provider 配置（含 baseURL/apiKey）
    const configPath = `${homedir()}/.zcode/cli/config.json`;
    const cliConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    const providerId = Object.keys(cliConfig.provider || {}).find(
      id => cliConfig.provider[id].enabled !== false
    );
    if (!providerId) return null;
    const cliProvider = cliConfig.provider[providerId];
    const apiKey = cliProvider.options?.apiKey;
    const baseURL = cliProvider.options?.baseURL;
    const kind = cliProvider.kind || 'openai-compatible';
    // apiFormat 映射：anthropic kind → anthropic-messages，其他 → openai-chat-completions
    const apiFormat = kind === 'anthropic' ? 'anthropic-messages' : 'openai-chat-completions';

    // 2. 从 workspace/readState 拿 modelCatalog（含 models 列表、revision）
    const state = await client.send('workspace/readState', {
      workspace: { workspaceKey: workspacePath, workspacePath }
    });
    const catalog = state?.modelCatalog;
    if (!catalog?.providers?.length) return null;
    const catProvider = catalog.providers.find(p => p.providerId === providerId) || catalog.providers[0];
    const modelId = catProvider.models[0]?.modelId;
    if (!modelId) return null;

    // 3. 构造完整 runtimeModel（y_ 类型）
    return {
      revision: String(catalog.revision || 0),
      generatedAt: Date.now(),
      model: { providerId, modelId },
      provider: {
        providerId,
        kind,
        apiFormat,
        label: catProvider.label || cliProvider.name || providerId,
        source: catProvider.source || 'builtin',
        baseURL,
        apiKey: apiKey ? { source: 'inline', value: apiKey } : undefined,
        models: catProvider.models.map(m => ({
          modelId: m.modelId,
          label: m.label,
          contextWindow: m.contextWindow,
        })),
      },
    };
  } catch {
    return null;
  }
}

export default buildRuntimeModel;
