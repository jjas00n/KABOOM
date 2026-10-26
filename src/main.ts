// 진입점: 물리 초기화 → 렌더러 → 씬 → 루프 시작
import type GUI from 'lil-gui';
import { BUILDING, QUALITY_PRESETS } from './config';
import { FrameTimer } from './core/FrameTimer';
import { Loop } from './core/Loop';
import { Renderer } from './core/Renderer';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { BuildingDemo } from './sandbox/BuildingDemo';
import { FractureDemo } from './sandbox/FractureDemo';
import { PhysicsSandbox } from './sandbox/PhysicsSandbox';
import { DebugGUI } from './ui/DebugGUI';
import { LoadingOverlay } from './ui/LoadingOverlay';

interface Demo {
  /** 고정 timestep마다 물리 스텝 직후 */
  step?(dt: number): void;
  update(): void;
  reset(): void;
  setupGui?: (gui: GUI) => void;
}

/** 기본은 Phase 3 건물. ?sandbox=fracture 면 Phase 2 박스 분할, ?sandbox=physics 면 Phase 1 샌드박스 */
function createDemo(renderer: Renderer, physics: PhysicsWorld): Demo {
  const sandbox = new URLSearchParams(window.location.search).get('sandbox');
  if (sandbox === 'physics') return new PhysicsSandbox(renderer, physics);
  if (sandbox === 'fracture') return createFractureDemo(renderer, physics);
  return createBuildingDemo(renderer, physics);
}

function createBuildingDemo(renderer: Renderer, physics: PhysicsWorld): Demo {
  const demo = new BuildingDemo(renderer, physics, new LoadingOverlay());
  const { limits } = BUILDING;
  return {
    step: (dt) => demo.step(dt),
    update: () => demo.update(),
    reset: () => demo.reset(),
    setupGui: (gui) => {
      const folder = gui.addFolder('Building');
      const s = demo.settings;
      folder.add(s, 'quality', Object.keys(QUALITY_PRESETS)).name('Quality');
      folder.add(s, 'floors', ...limits.floors, 1).name('Floors');
      folder.add(s, 'baysX', ...limits.bays, 1).name('Bays X');
      folder.add(s, 'baysZ', ...limits.bays, 1).name('Bays Z');
      folder.add(s, 'windowRatio', ...limits.windowRatio, 0.05).name('Window ratio');
      folder.add(s, 'seed', 0, 9999, 1).name('Seed');
      folder.add({ regenerate: () => demo.reset() }, 'regenerate').name('Regenerate');
      folder.add({ smash: () => demo.smashTest() }, 'smash').name('Smash test');
      folder
        .add(demo, 'debugColors')
        .name('Color fragments')
        .onChange((v: boolean) => demo.setDebugColors(v));
      folder.add(demo.stats, 'members').name('Members').disable().listen();
      folder.add(demo.stats, 'fragments').name('Fragments').disable().listen();
      folder.add(demo.stats, 'loadMs').name('Load ms').disable().listen();
    },
  };
}

function createFractureDemo(renderer: Renderer, physics: PhysicsWorld): Demo {
  const demo = new FractureDemo(renderer, physics);
  return {
    update: () => demo.update(),
    reset: () => demo.reset(),
    setupGui: (gui) => {
      const folder = gui.addFolder('Fracture');
      folder.add(demo.settings, 'seedCount', 2, 3000, 1).name('Seeds');
      folder.add(demo.settings, 'seedMode', ['uniform', 'jittered', 'adaptive']).name('Seed mode');
      folder.add(demo.settings, 'rngSeed', 0, 9999, 1).name('RNG seed');
      folder.add(demo, 'lastFractureMs').name('Fracture ms').disable().listen();
      folder.add({ rebuild: () => demo.reset() }, 'rebuild').name('Rebuild');
    },
  };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) {
    throw new Error('#app canvas not found');
  }

  const physics = await PhysicsWorld.create();
  const renderer = new Renderer(canvas);
  const demo = createDemo(renderer, physics);
  const timer = new FrameTimer();

  const loop = new Loop({
    step: (dt) => {
      const t = performance.now();
      physics.step();
      demo.step?.(dt);
      timer.add('physics', t);
      timer.countStep();
    },
    render: (alpha, realDt) => {
      let t = performance.now();
      demo.update();
      timer.add('update', t);
      t = performance.now();
      physics.sync(alpha);
      timer.add('sync', t);
      debug?.update(realDt);
      t = performance.now();
      renderer.render();
      timer.add('render', t);
      timer.endFrame(realDt);
    },
  });

  const debug = DebugGUI.isEnabled()
    ? new DebugGUI({
        stepper: loop.stepper,
        physics,
        timer,
        onReset: () => demo.reset(),
        setup: demo.setupGui,
      })
    : null;

  if (import.meta.env.DEV) {
    // 개발 중 콘솔/자동화 측정용 핸들
    (window as unknown as { __kaboom: unknown }).__kaboom = { physics, demo, loop, timer };
  }

  loop.start();
}

main().catch((err: unknown) => {
  console.error(err);
  const message = document.createElement('pre');
  message.textContent = `KABOOM failed to start:\n${String(err)}`;
  message.style.cssText = 'position:fixed;inset:0;margin:0;padding:16px;color:#f66;';
  document.body.append(message);
});
