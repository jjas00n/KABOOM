// lil-gui 디버그 패널 (개발 모드 또는 ?debug 에서만)
import GUI from 'lil-gui';
import { DEBUG } from '../config';
import type { FrameTimer } from '../core/FrameTimer';
import type { FixedStepper } from '../core/Loop';
import type { BodyStats, PhysicsWorld } from '../physics/PhysicsWorld';

export interface DebugGUIOptions {
  stepper: FixedStepper;
  physics: PhysicsWorld;
  timer: FrameTimer;
  onReset: () => void;
  /** 데모별 추가 컨트롤 */
  setup?: (gui: GUI) => void;
}

export class DebugGUI {
  static isEnabled(): boolean {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
  }

  private readonly gui = new GUI({ title: 'KABOOM debug' });
  private readonly stats = { fps: 0, bodies: 0 };
  private readonly bodyStats: BodyStats = {
    fixed: 0,
    dynamic: 0,
    awake: 0,
    sleeping: 0,
    contactPairs: 0,
  };
  private frames = 0;
  private elapsed = 0;

  constructor(private readonly options: DebugGUIOptions) {
    this.gui.add(this.stats, 'fps').name('FPS').disable().listen();
    this.gui.add(this.stats, 'bodies').name('Bodies').disable().listen();
    this.gui.add(options.stepper, 'timeScale', 0, 2, 0.05).name('Time scale');
    this.gui.add({ reset: options.onReset }, 'reset').name('Reset');

    // 프레임당 평균 CPU ms (DEBUG.fpsSampleSec 구간)
    const perf = this.gui.addFolder('Perf');
    const avg = options.timer.avg;
    perf.add(avg, 'frame').name('Frame ms').disable().listen();
    perf.add(avg, 'physics').name('Physics ms').disable().listen();
    perf.add(avg, 'steps').name('Steps / frame').disable().listen();
    perf.add(avg, 'update').name('Update ms').disable().listen();
    perf.add(avg, 'sync').name('Sync ms').disable().listen();
    perf.add(avg, 'render').name('Render ms (CPU)').disable().listen();
    const b = this.bodyStats;
    perf.add(b, 'fixed').name('Fixed').disable().listen();
    perf.add(b, 'dynamic').name('Dynamic').disable().listen();
    perf.add(b, 'awake').name('Awake').disable().listen();
    perf.add(b, 'sleeping').name('Sleeping').disable().listen();
    perf.add(b, 'contactPairs').name('Contact pairs').disable().listen();

    options.setup?.(this.gui);
  }

  update(realDt: number): void {
    this.frames++;
    this.elapsed += realDt;
    if (this.elapsed >= DEBUG.fpsSampleSec) {
      this.stats.fps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
      this.options.timer.flush();
      this.options.physics.collectStats(this.bodyStats);
    }
    this.stats.bodies = this.options.physics.bodyCount;
  }

  dispose(): void {
    this.gui.destroy();
  }
}
