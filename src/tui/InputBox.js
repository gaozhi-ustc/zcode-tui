import React, { useState } from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';

// 用 ink 生态标准的 TextInput:正确处理回显、光标位置、Backspace、多字节输入。
// (之前的自造实现只更新 ref 不更新 React state,导致组件不重渲染、字符不回显。)
export function InputBox({ onSubmit }) {
  const [value, setValue] = useState('');
  return React.createElement(Box, { flexDirection: 'row' },
    React.createElement(Text, { color: 'cyan' }, '> '),
    React.createElement(TextInput, {
      value,
      onChange: setValue,
      onSubmit: (v) => { if (v.trim()) { onSubmit(v); setValue(''); } }
    })
  );
}
