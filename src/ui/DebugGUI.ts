// lil-gui 디버그 패널 (개발 모드 또는 ?debug 에서만)
import GUI from 'lil-gui';
import { DEBUG } from '../config';
import type { FixedStepper } from '../core/Loop';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export interface DebugGUIOptions {
  stepper: FixedStepper;
  physics: PhysicsWorld;
  onReset: () => void;
}

export class DebugGUI {
  static isEnabled(): boolean {
    return import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug');
  }

  private readonly gui = new GUI({ title: 'KABOOM debug' });
  private readonly stats = { fps: 0, bodies: 0 };
  private frames = 0;
  private elapsed = 0;

  constructor(private readonly options: DebugGUIOptions) {
    this.gui.add(this.stats, 'fps').name('FPS').disable().listen();
    this.gui.add(this.stats, 'bodies').name('Bodies').disable().listen();
    this.gui.add(options.stepper, 'timeScale', 0, 2, 0.05).name('Time scale');
    this.gui.add({ reset: options.onReset }, 'reset').name('Reset boxes');
  }

  update(realDt: number): void {
    this.frames++;
    this.elapsed += realDt;
    if (this.elapsed >= DEBUG.fpsSampleSec) {
      this.stats.fps = Math.round(this.frames / this.elapsed);
      this.frames = 0;
      this.elapsed = 0;
    }
    this.stats.bodies = this.options.physics.bodyCount;
  }

  dispose(): void {
    this.gui.destroy();
  }
}
