/**
 * 双档阈值：
 * - current：按现状校准，全部通过 = 回归保护网
 * - target：aspirational，用 test.fails 标记 = 优化靶点；
 *   优化落地致其意外通过时，把它提升到 current。
 */
export const budgets = {
  current: {
    spinnerIdleMaxFps: 12,       // tick 100ms → 理论 ~10fps
    spinnerStreamingMaxFps: 12,  // tick 500ms → 理论 ~2fps，留足余量
    toolBlinkMaxFramesPer5s: 25, // 3 工具 blink(1200ms) + spinner(500ms)
    burstMaxFrames: 25,          // 50 delta @10ms（500ms 窗口，30fps 上限 ~17）
    keystrokeMaxFrames: 40,      // 20 击键 × ≤2 帧
    resizeMaxFullClears: 2,      // 两次缩宽各一次全清
  },
  target: {
    spinnerIdleMaxFps: 2,        // 时钟隔离到叶子组件后，整树不应按 tick 重写
    spinnerStreamingMaxFps: 2,
    toolBlinkMaxFramesPer5s: 6,
    burstMaxFrames: 10,          // 应用层合帧后
    keystrokeMaxFrames: 21,      // 每击键恰好 1 帧
    resizeMaxFullClears: 2,
  },
};
