import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { vi } from 'vitest';

/**
 * ink 7 在交互 TTY 下用同步更新序列包裹每次逻辑帧（ink.js throttledLog）：
 *   write(BSU) → write(erase+content) → write(ESU)
 * 若按 write() 调用计帧，BSU/ESU 会单独成帧：fps 虚高 ~3x，
 * 且这些"空内容幻影帧"会让 stableLineViolations 误报稳定区被擦除。
 * 因此把 BSU..ESU 之间的 writes 合并为一个逻辑帧。
 */
const BSU = '\x1b[?2026h'; // begin synchronized update
const ESU = '\x1b[?2026l'; // end synchronized update

/** 可测 stdout：记录每次逻辑帧的原始字符串，尺寸可配，可模拟 resize。 */
export class TestStdout extends EventEmitter {
  isTTY = true;
  frames = [];
  #pendingSync = null;

  constructor({ columns = 100, rows = 30 } = {}) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (frame) => {
    const s = String(frame);
    if (this.#pendingSync !== null) {
      this.#pendingSync += s;
      if (s.includes(ESU)) {
        this.frames.push(this.#pendingSync);
        this.#pendingSync = null;
      }
      return true;
    }
    if (s.includes(BSU) && !s.includes(ESU)) {
      this.#pendingSync = s;
      return true;
    }
    this.frames.push(s);
    return true;
  };

  resize(columns, rows = this.rows) {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  lastFrame = () => this.frames[this.frames.length - 1];
}

export class TestStdin extends EventEmitter {
  isTTY = true;
  data = null;
  write = (data) => { this.data = data; this.emit('readable'); this.emit('data', data); };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read = () => { const d = this.data; this.data = null; return d; };
}

/**
 * 以真实交互模式渲染 ink 树（debug:false + interactive:true）。
 * 与 ink-testing-library 的关键差别：保留 eraseLines/全清等擦除序列，
 * 使 frames[] 可用于闪烁度量。
 */
export function renderInk(element, { columns = 100, rows = 30 } = {}) {
  const stdout = new TestStdout({ columns, rows });
  const stderr = new TestStdout({ columns, rows });
  const stdin = new TestStdin();
  const instance = inkRender(element, {
    stdout, stderr, stdin,
    debug: false,
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  });
  return {
    stdout, stderr, stdin,
    frames: stdout.frames,
    lastFrame: () => stdout.lastFrame(),
    rerender: instance.rerender,
    unmount: instance.unmount,
    cleanup: instance.cleanup,
  };
}

/** 推进 fake timers 并 flush 微任务（驱动 ink throttle 帧发射）。 */
export async function flushFrames(ms = 100) {
  await vi.advanceTimersByTimeAsync(ms);
}
