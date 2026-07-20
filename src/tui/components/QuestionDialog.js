import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

/**
 * 向用户提问的交互式对话框。
 * 对齐 Claude Code 的 QuestionView + PermissionRequestTitle + Select/SelectMulti。
 *
 * 解决"有提问入口但看不到问题"的问题：同时渲染
 *   1. 问题文本（header chip 标签 + 加粗的问题正文）
 *   2. 选项列表（单选 ↑↓+Enter / 多选 Space 勾选 + Enter 提交）
 *   3. 多题导航（Tab 下一题）
 *
 * 交互键：
 *   ↑/↓ 或 k/j   上下移动高亮
 *   Enter         单选：确认当前选项；多选：提交已勾选项
 *   Space         多选：勾选/取消当前项
 *   Esc / Ctrl+C  取消（回复 cancel）
 *   Tab           切换到下一题（多题时）
 *
 * @param {object} props
 * @param {Array}  props.questions       - [{ header, question, options:[{label,description}], multiSelect }]
 * @param {function} props.onRespond     - (answers: object) => void，把每个问题的回答回传
 *                                         answers 形如 { [question文本]: label | label[] }
 * @param {function} props.onCancel      - () => void
 */
/** 选项显示文本：label 缺失时兜底 name/title/value/字符串本身（真实 server 的
 * 选项 schema 可能不带 label，现场出现过选项行空白、用户无法确认选择）。 */
function optionLabel(opt) {
  if (typeof opt === 'string') return opt;
  if (!opt || typeof opt !== 'object') return '';
  return opt.label ?? opt.name ?? opt.title ?? opt.value ?? '';
}

/** 选项提交值：server 以 value 判定回答（如 plan 审批期望 'approve'），
 * 缺 value 时退回显示文本（AskUserQuestion 的 value 就等于 label）。 */
function optionValue(opt) {
  if (typeof opt === 'string') return opt;
  if (!opt || typeof opt !== 'object') return '';
  return opt.value ?? optionLabel(opt);
}

export function QuestionDialog({ questions = [], onRespond, onCancel }) {
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [checked, setChecked] = useState({});
  const [answers, setAnswers] = useState({});
  // 防止 Enter 重复触发 onRespond（组件卸载前的同一 tick 可能多次收到按键）
  const respondedRef = useRef(false);

  const question = questions[qIndex];
  if (!question) return null;

  const isMulti = !!question.multiSelect;
  const options = question.options || [];
  const isLast = qIndex >= questions.length - 1;

  // 多选时当前题的已勾选项（用数组模拟 Set，保持纯数据）
  const checkedArr = checked[question.question] || [];

  const advanceOrSubmit = () => {
    if (isLast) {
      // 所有题答完，提交
      onRespond(answers);
    } else {
      setQIndex(i => i + 1);
      setSelected(0);
    }
  };

  useInput((inputKey, key) => {
    if (respondedRef.current) return; // 已提交/取消，忽略后续按键
    if (key.escape || inputKey === '\x03') {
      respondedRef.current = true;
      onCancel();
      return;
    }
    if (key.upArrow || inputKey === 'k') {
      setSelected(s => Math.max(0, s - 1));
      return;
    }
    if (key.downArrow || inputKey === 'j') {
      setSelected(s => Math.min(options.length - 1, s + 1));
      return;
    }
    if (isMulti && inputKey === ' ') {
      // 勾选/取消当前项
      setChecked(prev => {
        const cur = prev[question.question] || [];
        const next = cur.includes(selected)
          ? cur.filter(i => i !== selected)
          : [...cur, selected];
        return { ...prev, [question.question]: next };
      });
      return;
    }
    if (key.return) {
      if (isMulti) {
        const cur = checked[question.question] || [];
        const chosen = cur.length > 0 ? cur : [selected];
        const labels = chosen.map(i => optionValue(options[i])).filter(Boolean);
        const newAnswers = { ...answers, [question.question]: labels };
        setAnswers(newAnswers);
        if (isLast) { respondedRef.current = true; onRespond(newAnswers); }
        else { setQIndex(i => i + 1); setSelected(0); }
      } else {
        const label = optionValue(options[selected]);
        const newAnswers = { ...answers, [question.question]: label };
        setAnswers(newAnswers);
        if (isLast) { respondedRef.current = true; onRespond(newAnswers); }
        else { setQIndex(i => i + 1); setSelected(0); }
      }
      return;
    }
    if (key.tab && !isLast) {
      // 跳到下一题（保留已答）
      setQIndex(i => i + 1);
      setSelected(0);
    }
  });

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      marginTop: 1,
      paddingX: 1,
    },
    // 多题导航条：[1/3] chip chips
    questions.length > 1 && React.createElement(
      Box,
      { marginBottom: 1 },
      React.createElement(
        Text,
        { color: 'cyan', bold: true },
        `问题 ${qIndex + 1}/${questions.length}`
      ),
      React.createElement(Text, { dimColor: true }, '  ·  '),
      ...questions.map((q, i) => {
        const answered = answers[q.question] != null || (checked[q.question] && checked[q.question].length > 0);
        const isCurrent = i === qIndex;
        const color = isCurrent ? 'cyan' : answered ? 'green' : 'gray';
        return React.createElement(
          Text,
          { key: i, color, bold: isCurrent },
          `[${q.header || ('Q' + (i + 1))}] `
        );
      })
    ),
    // header chip（对标 QuestionNavigationBar 的 chip）
    question.header && React.createElement(
      Text,
      { color: 'cyan', bold: true },
      question.header
    ),
    // 问题正文（对标 PermissionRequestTitle，加粗显示，确保一定能看到）
    React.createElement(
      Text,
      { bold: true },
      question.question
    ),
    // 选项列表
    React.createElement(
      Box,
      { flexDirection: 'column', marginTop: 1 },
      options.map((opt, i) => {
        const isSel = i === selected;
        const isChecked = isMulti && checkedArr.includes(i);
        const pointer = isSel ? '❯' : ' ';
        const check = isMulti ? (isChecked ? '◉' : '◯') : (isSel ? '●' : '○');
        const label = optionLabel(opt);
        return React.createElement(
          Box,
          { key: i, flexDirection: 'column' },
          React.createElement(
            Box,
            null,
            React.createElement(Text, { color: isSel ? 'cyan' : undefined, bold: isSel }, `${pointer} ${check} `),
            // 选中项用反色（背景色）高亮，任何终端/tmux 下都清晰可见
            React.createElement(
              Text,
              isSel
                ? { bold: true, color: 'black', backgroundColor: 'cyan' }
                : {},
              ` ${label} `
            )
          ),
          opt.description && React.createElement(
            Text,
            { dimColor: true, key: `d${i}` },
            `    ${opt.description}`
          )
        );
      })
    ),
    // 操作提示：确认/取消用高亮 chip，用户一眼可辨当前可用动作
    React.createElement(
      Box,
      { marginTop: 1 },
      React.createElement(
        Text,
        { backgroundColor: 'cyan', color: 'black', bold: true },
        ` Enter ${isMulti ? (isLast ? '提交' : '下一题') : (isLast ? '确认' : '下一题')} `
      ),
      React.createElement(Text, null, '  '),
      React.createElement(
        Text,
        { backgroundColor: 'red', color: 'black' },
        ' Esc 取消 '
      ),
      React.createElement(
        Text,
        { dimColor: true },
        `   [↑↓] 移动${isMulti ? '  [Space] 勾选' : ''}${!isLast && !isMulti ? '  [Tab] 跳过' : ''}`
      )
    )
  );
}

export default QuestionDialog;
