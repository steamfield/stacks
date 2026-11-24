/**
 * Fixed-timestep driver. Game logic advances in fixed ticks of TICK_DT seconds and never reads a
 * clock. In play, the engine's frame callback calls `frame(realDeltaSeconds)`; in tests the shell
 * calls `advance(n)` to run exactly n ticks. A "frame" in scenarios and `see` options always means
 * a tick.
 */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

export class FixedStep {
  private accumulator = 0;
  /** Total ticks run since start. */
  tick = 0;

  private readonly step: (dt: number, tick: number) => void;
  /** Upper bound on ticks per frame, so a long stall (tab in background) doesn't spiral. */
  private readonly maxTicksPerFrame: number;

  constructor(step: (dt: number, tick: number) => void, maxTicksPerFrame = 5) {
    this.step = step;
    this.maxTicksPerFrame = maxTicksPerFrame;
  }

  /** Real-time mode: accumulate wall time and run as many whole ticks as fit. Returns ticks run. */
  frame(realDeltaSeconds: number): number {
    this.accumulator = Math.min(
      this.accumulator + realDeltaSeconds,
      TICK_DT * this.maxTicksPerFrame,
    );
    let ran = 0;
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.runOne();
      ran++;
    }
    return ran;
  }

  /** Test mode: run exactly n ticks, ignoring wall time. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.runOne();
  }

  /** Fraction of a tick left in the accumulator, for render interpolation. */
  get alpha(): number {
    return this.accumulator / TICK_DT;
  }

  private runOne(): void {
    this.step(TICK_DT, this.tick);
    this.tick++;
  }
}
