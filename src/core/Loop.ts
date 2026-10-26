// 고정 timestep(60Hz) 물리 + 렌더 보간 루프, timeScale 지원
import { PHYSICS } from '../config';

/** accumulator 방식 고정 스텝 계산. DOM 의존 없음(단위 테스트 대상). */
export class FixedStepper {
  /** 1 = 실시간, 0.2 = 슬로모션, 0 = 정지 */
  timeScale = 1;
  private accumulator = 0;

  constructor(
    readonly fixedTimestep: number = PHYSICS.fixedTimestep,
    readonly maxSubSteps: number = PHYSICS.maxSubSteps,
    readonly maxFrameDt: number = PHYSICS.maxFrameDt,
  ) {}

  /** 실제 경과 시간(초)을 넣으면 이번 프레임에 돌릴 물리 스텝 수를 반환 */
  advance(realDt: number): number {
    const dt = Math.min(Math.max(realDt, 0), this.maxFrameDt) * Math.max(this.timeScale, 0);
    this.accumulator += dt;

    // 부동소수 누적 오차로 1스텝이 0.99999스텝이 되는 것 방지
    let steps = Math.floor(this.accumulator / this.fixedTimestep + 1e-9);
    if (steps > this.maxSubSteps) {
      steps = this.maxSubSteps;
      this.accumulator = 0; // 따라잡지 못한 시간은 버린다
    } else {
      this.accumulator = Math.max(this.accumulator - steps * this.fixedTimestep, 0);
    }
    return steps;
  }

  /** 렌더 보간 계수 [0, 1): 이전 물리 상태 → 현재 물리 상태 */
  get alpha(): number {
    return this.accumulator / this.fixedTimestep;
  }

  reset(): void {
    this.accumulator = 0;
  }
}

export interface LoopCallbacks {
  step(dt: number): void;
  render(alpha: number, realDt: number): void;
}

/** requestAnimationFrame 드라이버 */
export class Loop {
  readonly stepper = new FixedStepper();
  private rafId = 0;
  private lastTime = 0;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.rafId !== 0) return;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    const realDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    const steps = this.stepper.advance(realDt);
    for (let i = 0; i < steps; i++) {
      this.callbacks.step(this.stepper.fixedTimestep);
    }
    this.callbacks.render(this.stepper.alpha, realDt);

    this.rafId = requestAnimationFrame(this.tick);
  };
}
