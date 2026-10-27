// 진입점: 물리 초기화 → 렌더러 → 텍스처/HDRI → 루프 → 게임(또는 디버그 샌드박스) 시작
import type GUI from 'lil-gui';
import { loadAssets, type Assets } from './core/Assets';
import { FrameTimer } from './core/FrameTimer';
import { Loop } from './core/Loop';
import { Renderer } from './core/Renderer';
import { Game, type TimeControl } from './game/Game';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { BuildingDemo } from './sandbox/BuildingDemo';
import { FractureDemo } from './sandbox/FractureDemo';
import { PhysicsSandbox } from './sandbox/PhysicsSandbox';
import { addBuildingGui } from './ui/buildingGui';
import { addVisualsGui } from './ui/visualsGui';
import { DebugGUI } from './ui/DebugGUI';
import { LoadingOverlay } from './ui/LoadingOverlay';

interface Demo {
  /** 고정 timestep마다 물리 스텝 직후 */
  step?(dt: number): void;
  /** 렌더 프레임마다 (실제 경과 시간) */
  update(dt: number): void;
  reset(): void;
  setupGui?: (gui: GUI) => void;
  /** 개발 중 콘솔/자동화에서 만질 수 있게 노출할 객체 (window.__kaboom.handle) */
  handle?: unknown;
}

/**
 * 기본은 게임. 디버그 샌드박스:
 * ?sandbox=building (건물 + 클릭 폭발 + 재현 시나리오), fracture (박스 분할), physics (박스 200개)
 */
function createDemo(
  renderer: Renderer,
  physics: PhysicsWorld,
  time: TimeControl,
  loading: LoadingOverlay,
  assets: Assets,
): Demo {
  const sandbox = new URLSearchParams(window.location.search).get('sandbox');
  if (sandbox === 'physics') return new PhysicsSandbox(renderer, physics, assets);
  if (sandbox === 'fracture') return createFractureDemo(renderer, physics, assets);
  if (sandbox === 'building') return createBuildingDemo(renderer, physics, time, loading, assets);
  return createGame(renderer, physics, time, loading, assets);
}

function createGame(
  renderer: Renderer,
  physics: PhysicsWorld,
  time: TimeControl,
  loading: LoadingOverlay,
  assets: Assets,
): Demo {
  const game = new Game(renderer, physics, time, loading, assets);
  return {
    step: (dt) => game.step(dt),
    update: (dt) => game.update(dt),
    reset: () => game.reset(),
    handle: game,
    setupGui: (gui) => {
      const folder = gui.addFolder('Game');
      folder.add(game, 'state').name('State').disable().listen();
      folder.add(game, 'power', 0, 1, 0.01).name('Power').listen();
      addBuildingGui(gui, game.site, () => game.reset());
      addVisualsGui(gui, renderer.postfx, game.site);
    },
  };
}

function createBuildingDemo(
  renderer: Renderer,
  physics: PhysicsWorld,
  time: TimeControl,
  loading: LoadingOverlay,
  assets: Assets,
): Demo {
  const demo = new BuildingDemo(renderer, physics, loading, assets, time);
  return {
    step: (dt) => demo.step(dt),
    update: (dt) => demo.update(dt),
    reset: () => demo.reset(),
    handle: demo,
    setupGui: (gui) => {
      const folder = addBuildingGui(gui, demo.site, () => demo.reset());
      folder.add({ smash: () => demo.smashTest() }, 'smash').name('Smash test');
      folder.add({ pull: () => demo.pullColumns() }, 'pull').name('Pull front columns');
      folder.add({ smash: () => demo.smashViewed() }, 'smash').name('Smash test (view)');
      folder.add({ pull: () => demo.pullViewed() }, 'pull').name('Pull columns (view)');
      addVisualsGui(gui, renderer.postfx, demo.site);
    },
  };
}

function createFractureDemo(renderer: Renderer, physics: PhysicsWorld, assets: Assets): Demo {
  const demo = new FractureDemo(renderer, physics, assets);
  return {
    update: (dt) => demo.update(dt),
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
  const loading = new LoadingOverlay();
  loading.show('Loading textures…');
  const assets = await loadAssets(renderer.webgl, (f) => loading.progress(f));
  loading.hide();
  const timer = new FrameTimer();
  // 루프 콜백은 아래에서 만드는 demo를 쓴다 (게임이 hit-stop용으로 loop.stepper를 받아야 해서 루프가 먼저)
  let demo: Demo | null = null;

  const loop = new Loop({
    step: (dt) => {
      const t = performance.now();
      physics.step();
      demo?.step?.(dt);
      timer.add('physics', t);
      timer.countStep();
    },
    render: (alpha, realDt) => {
      let t = performance.now();
      demo?.update(realDt);
      timer.add('update', t);
      t = performance.now();
      physics.sync(alpha);
      timer.add('sync', t);
      debug?.update(realDt);
      t = performance.now();
      renderer.render(realDt);
      timer.add('render', t);
      timer.endFrame(realDt);
    },
  });
  const active = createDemo(renderer, physics, loop.stepper, loading, assets);
  demo = active;

  const debug = DebugGUI.isEnabled()
    ? new DebugGUI({
        stepper: loop.stepper,
        physics,
        timer,
        onReset: () => active.reset(),
        setup: active.setupGui,
      })
    : null;

  if (import.meta.env.DEV) {
    // 개발 중 콘솔/자동화 측정용 핸들
    (window as unknown as { __kaboom: unknown }).__kaboom = {
      physics,
      demo: active,
      handle: active.handle,
      loop,
      timer,
    };
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
