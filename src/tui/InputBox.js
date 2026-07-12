import React, { useState, useRef, useCallback } from 'react';
import { Text, Box, useStdin } from 'ink';

// Minimal internal text input. ink@7 does not export TextInput (that lives in
// the separate `ink-text-input` package, which is not installed). This inline
// component reads raw keystrokes via useStdin so InputBox stays self-contained
// and keeps the same public API (onSubmit prop + '>' prompt).
//
// 实现要点:handler 通过 ref 读当前 value、用函数式更新累积多字符 chunk,
// effect 只依赖稳定项(stdin/setRawMode/isRawModeSupported),避免每次按键
// 重注册监听器导致的闭包过期与字符丢失。
function useTextInput({ onSubmit }) {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();
  // ref 持有最新 value,handler 读它而非闭包变量
  const valueRef = useRef('');
  // stable callbacks
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const apply = useCallback((fn) => {
    valueRef.current = fn(valueRef.current);
    return valueRef.current;
  }, []);

  React.useEffect(() => {
    if (!isRawModeSupported) return;
    const handleData = (data) => {
      // 每个字符基于 valueRef 累积,函数式更新避免 chunk 内丢字符
      for (const char of String(data)) {
        const code = char.codePointAt(0);
        if (code === 13 || code === 10) {
          // Enter — 提交当前值
          const v = valueRef.current;
          if (v.trim()) onSubmitRef.current?.(v);
        } else if (code === 127 || code === 8) {
          // Backspace
          apply((v) => v.slice(0, -1));
        } else if (code === 3) {
          // Ctrl+C — 清空
          apply(() => '');
        } else if (code >= 32 && code !== 127) {
          // 可打印字符:追加
          apply((v) => v + char);
        }
      }
    };

    setRawMode(true);
    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
      setRawMode(false);
    };
  }, [stdin, setRawMode, isRawModeSupported, apply]);

  return valueRef;
}

export function InputBox({ onSubmit }) {
  const [value, setValue] = useState('');
  const valueRef = useTextInput({
    onSubmit: (v) => { onSubmit(v); setValue(''); },
  });
  // 同步 ref → state 用于渲染;ref 是输入处理的真相源
  React.useEffect(() => { valueRef.current = value; }, [value, valueRef]);
  return React.createElement(Box, { flexDirection: 'row' },
    React.createElement(Text, { color: 'cyan' }, '> '),
    React.createElement(Text, null, value)
  );
}
