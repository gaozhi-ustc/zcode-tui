import { EventEmitter } from 'node:events';
import { render as inkRender } from 'ink';
import { vi } from 'vitest';

/** 可测 stdout：记录每次 write 的原始字符串，尺寸可配，可模拟 resize。 */
export class TestStdout extends EventEmitter {
  isTTY = true;
  frames = [];

  constructor({ columns = 100, rows = 30 } = {}) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  write = (frame) => {
    this.frames.push(String(frame));
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
