import React, { useState } from 'react';
import { Text, Box, useStdin } from 'ink';

// Minimal internal text input. ink@7 does not export TextInput (that lives in
// the separate `ink-text-input` package, which is not installed). This inline
// component reads raw keystrokes via useStdin so InputBox stays self-contained
// and keeps the same public API (onSubmit prop + '>' prompt).
function useTextInput({ value, onChange, onSubmit }) {
  const { stdin, setRawMode, isRawModeSupported } = useStdin();

  React.useEffect(() => {
    if (!isRawModeSupported) return;
    const handleData = (data) => {
      const ch = String(data);
      for (const char of ch) {
        const code = char.codePointAt(0);
        if (code === 13 || code === 10) {
          // Enter
          if (onSubmit) onSubmit(value);
        } else if (code === 127 || code === 8) {
          // Backspace
          if (onChange) onChange(value.slice(0, -1));
        } else if (code === 3) {
          // Ctrl+C
          if (onChange) onChange('');
        } else if (code >= 32 && code !== 127) {
          if (onChange) onChange(value + char);
        }
      }
    };

    setRawMode(true);
    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
      setRawMode(false);
    };
  }, [value, onChange, onSubmit, stdin, setRawMode, isRawModeSupported]);
}

export function InputBox({ onSubmit }) {
  const [value, setValue] = useState('');
  useTextInput({
    value,
    onChange: setValue,
    onSubmit: (v) => { if (v.trim()) { onSubmit(v); setValue(''); } },
  });
  return React.createElement(Box, { flexDirection: 'row' },
    React.createElement(Text, { color: 'cyan' }, '> '),
    React.createElement(Text, null, value)
  );
}
