import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * 模型选择面板。
 * 列出可用模型，↑↓ 选择，Enter 确认，Esc 取消。
 *
 * @param {object} props
 * @param {Array} props.models - 可用模型列表 [{label, providerLabel, ref:{modelId,providerId}, contextWindow}]
 * @param {string} props.currentModel - 当前模型
 * @param {function} props.onSelect - 选择回调 (model) => void
 * @param {function} props.onCancel - 取消回调
 */
export function ModelPicker({ models, currentModel, onSelect, onCancel }) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    // 默认选中当前模型
    const idx = models.findIndex(m => m.ref?.modelId === currentModel || m.label === currentModel);
    setSelected(idx >= 0 ? idx : 0);
  }, [models, currentModel]);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected(s => Math.min(models.length - 1, s + 1));
    } else if (key.return) {
      if (models[selected]) onSelect(models[selected]);
    } else if (key.escape || input === 'q') {
      onCancel();
    }
  });

  if (models.length === 0) {
    return React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      React.createElement(Text, { color: 'red' }, '没有可用的模型'),
      React.createElement(Text, { dimColor: true }, '[Esc] 返回')
    );
  }

  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1, borderStyle: 'round', borderColor: 'cyan', paddingX: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, '选择模型'),
    ...models.map((m, i) => {
      const isCurrent = m.ref?.modelId === currentModel || m.label === currentModel;
      const isSelected = i === selected;
      return React.createElement(
        Box,
        { key: i, flexDirection: 'row' },
        React.createElement(Text, { color: isSelected ? 'black' : undefined, backgroundColor: isSelected ? 'cyan' : undefined },
          isSelected ? ' ❯ ' : '   '),
        React.createElement(Text, { bold: isSelected, color: isSelected ? 'cyan' : undefined },
          ` ${m.label || m.ref?.modelId || 'unknown'} `),
        React.createElement(Text, { dimColor: true }, m.providerLabel || ''),
        isCurrent && React.createElement(Text, { color: 'green' }, ' ✓'),
        m.contextWindow && React.createElement(Text, { dimColor: true }, `  (${Math.round(m.contextWindow / 1000)}k ctx)`)
      );
    }),
    React.createElement(Text, { dimColor: true, marginTop: 1 }, '[↑↓] 选择  [Enter] 确认  [Esc] 取消')
  );
}

export default ModelPicker;
