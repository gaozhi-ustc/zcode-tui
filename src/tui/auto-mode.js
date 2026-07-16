/**
 * Auto mode 权限分类器。
 *
 * 对齐 Claude Code 的 yoloClassifier：每次权限请求调 LLM 判断
 * 是否可以自动批准。如果安全则 allow，不安全则 block（回退人工授权）。
 *
 * 分类器构建精简 prompt（工具名+参数摘要），调 GLM 返回 allow/block。
 * fail-closed：分类器不可用时 block（保持人工授权）。
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

// 读 cli config 拿 baseURL/apiKey/model
function getCliConfig() {
  try {
    const configPath = `${homedir()}/.zcode/cli/config.json`;
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const providerId = Object.keys(config.provider || {}).find(
      id => config.provider[id].enabled !== false
    );
    if (!providerId) return null;
    const provider = config.provider[providerId];
    return {
      baseURL: provider.options?.baseURL,
      apiKey: provider.options?.apiKey,
      model: config.model?.split('/')?.pop() || 'GLM-5.2',
    };
  } catch { return null; }
}

// 全局缓存 config
let _config = null;

/**
 * 分类器 prompt 构建。
 * 精简到只含工具名+参数+风险评估指令，不传完整对话（避免注入+省 token）。
 */
function buildPrompt(toolName, input, riskLevel) {
  // 参数摘要（截断长内容）
  let paramSummary = '';
  if (input && typeof input === 'object') {
    const fields = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'content', 'old_string', 'new_string'];
    for (const f of fields) {
      if (input[f] != null) {
        const val = String(input[f]).slice(0, 200);
        paramSummary += `  ${f}: ${val}\n`;
      }
    }
    if (!paramSummary) paramSummary = `  ${JSON.stringify(input).slice(0, 200)}`;
  }

  return `You are a security classifier for an AI coding assistant. Decide if the following tool action is SAFE to auto-approve.

Tool: ${toolName}
Risk Level: ${riskLevel || 'unknown'}
Parameters:
${paramSummary}

Rules:
- ALLOW: read-only operations (reading files, searching, listing), safe file writes in workspace, common dev commands (ls, cat, grep, npm test, git status)
- BLOCK: destructive commands (rm -rf, sudo, format), network operations to untrusted hosts, writing outside workspace, anything that could cause data loss

Respond with ONLY "ALLOW" or "BLOCK" on the first line, optionally followed by a one-line reason.`;
}

/**
 * 调 GLM 分类器判断权限请求。
 *
 * @param {string} toolName - 工具名
 * @param {object} input - 工具输入参数
 * @param {string} riskLevel - 风险等级 (low/medium/high/critical)
 * @returns {Promise<{shouldBlock: boolean, reason: string}>}
 *          shouldBlock=false → 自动允许；shouldBlock=true → 回退人工
 */
export async function classifyPermission(toolName, input, riskLevel) {
  if (!_config) _config = getCliConfig();
  if (!_config?.baseURL || !_config?.apiKey) {
    return { shouldBlock: true, reason: '分类器未配置：无法读取 API 配置' };
  }

  const prompt = buildPrompt(toolName, input, riskLevel);

  try {
    // 调 Anthropic-compatible API（app-server 用的是 anthropic 格式）
    const response = await fetch(`${_config.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': _config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: _config.model,
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      return { shouldBlock: true, reason: `分类器 API 错误: ${response.status}` };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const firstLine = text.trim().split('\n')[0].toUpperCase();

    // 解析 ALLOW / BLOCK
    if (firstLine.includes('ALLOW') || firstLine.includes('SAFE')) {
      const reason = text.trim().split('\n').slice(1).join(' ').trim() || 'auto-approved';
      return { shouldBlock: false, reason };
    }
    // BLOCK 或无法解析 → fail-closed（block）
    const reason = text.trim().split('\n').slice(1).join(' ').trim() || 'blocked by classifier';
    return { shouldBlock: true, reason };
  } catch (e) {
    // fail-closed：网络错误等技术问题时 block
    return { shouldBlock: true, reason: `分类器不可用: ${e.message}` };
  }
}

export default classifyPermission;
