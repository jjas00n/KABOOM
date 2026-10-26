// 진입점: 물리 초기화 → 렌더러 → 씬 → 루프 시작
import type GUI from 'lil-gui';
import { Loop } from './core/Loop';
import { Renderer } from './core/Renderer';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { FractureDemo } from './sandbox/FractureDemo';
import { PhysicsSandbox } from './sandbox/PhysicsSandbox';
import { DebugGUI } from './ui/DebugGUI';

/** ?sandbox=physics 면 Phase 1 박스 샌드박스, 기본은 Phase 2 분할 데모 */
function createDemo(
  renderer: Renderer,
  physics: PhysicsWorld,
): {
  update(): void;
  reset(): void;
  setupGui?: (gui: GUI) => void;
} {
  if (new URLSearchParams(window.location.search).get('sandbox') === 'physics') {
    return new PhysicsSandbox(renderer, physics);
  }
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

  const loop = new Loop({
    step: () => physics.step(),
    render: (alpha, realDt) => {
      demo.update();
      physics.sync(alpha);
      debug?.update(realDt);
      renderer.render();
    },
  });

  const debug = DebugGUI.isEnabled()
    ? new DebugGUI({
        stepper: loop.stepper,
        physics,
        onReset: () => demo.reset(),
        setup: demo.setupGui,
      })
    : null;

  loop.start();
}

main().catch((err: unknown) => {
  console.error(err);
  const message = document.createElement('pre');
  message.textContent = `KABOOM failed to start:\n${String(err)}`;
  message.style.cssText = 'position:fixed;inset:0;margin:0;padding:16px;color:#f66;';
  document.body.append(message);
});
