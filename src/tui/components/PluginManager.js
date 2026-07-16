import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * 插件管理面板。
 * 列出已安装插件，支持启用/禁用/卸载。
 *
 * @param {object} props
 * @param {Array} props.plugins - 已安装插件列表
 * @param {function} props.onAction - (action: 'enable'|'disable'|'uninstall', pluginId) => void
 * @param {function} props.onClose - () => void
 */
export function PluginManager({ plugins = [], onAction, onClose }) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [plugins]);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow) {
      setSelected(s => Math.min(Math.max(plugins.length - 1, 0), s + 1));
      return;
    }
    if (plugins.length === 0) return;
    const current = plugins[selected];
    if (!current) return;
    // e: enable, d: disable, u: uninstall
    if (input === 'e' && !current.enabled) {
      onAction('enable', current.id);
    } else if (input === 'd' && current.enabled) {
      onAction('disable', current.id);
    } else if (input === 'u') {
      onAction('uninstall', current.id);
    }
  });

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, borderStyle: 'round', borderColor: 'magenta', paddingX: 1 },
    React.createElement(Text, { bold: true, color: 'magenta' }, `插件管理 (${plugins.length} 个已安装)`),
    plugins.length === 0
      ? React.createElement(Text, { dimColor: true }, '没有已安装的插件')
      : plugins.map((p, i) => {
          const isSel = i === selected;
          const status = p.enabled ? '✓ 启用' : '✗ 禁用';
          const statusColor = p.enabled ? 'green' : 'gray';
          return React.createElement(
            Box,
            { key: p.id || i, flexDirection: 'column' },
            React.createElement(
              Box,
              { flexDirection: 'row' },
              React.createElement(Text, null, isSel ? '❯ ' : '  '),
              React.createElement(Text, { color: statusColor, bold: isSel }, status),
              React.createElement(Text, { bold: isSel }, ` ${p.name || p.id}`),
              p.version && React.createElement(Text, { dimColor: true }, ` v${p.version}`),
            ),
            isSel && React.createElement(
              Box,
              { flexDirection: 'column', paddingLeft: 4 },
              React.createElement(Text, { dimColor: true }, (p.description || '').slice(0, 80)),
              React.createElement(
                Text,
                { dimColor: true },
                `${p.enabled ? '[d] 禁用' : '[e] 启用'}  [u] 卸载`
              ),
            ),
          );
        }),
    React.createElement(
      Text,
      { dimColor: true, marginTop: 1 },
      '[↑↓] 选择  [e] 启用  [d] 禁用  [u] 卸载  [Esc] 关闭'
    )
  );
}

export default PluginManager;
