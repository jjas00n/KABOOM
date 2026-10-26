// 진입점: 물리 초기화 → 렌더러 → 씬 → 루프 시작
import { Loop } from './core/Loop';
import { Renderer } from './core/Renderer';
import { PhysicsWorld } from './physics/PhysicsWorld';
import { PhysicsSandbox } from './sandbox/PhysicsSandbox';
import { DebugGUI } from './ui/DebugGUI';

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) {
    throw new Error('#app canvas not found');
  }

  const physics = await PhysicsWorld.create();
  const renderer = new Renderer(canvas);
  const sandbox = new PhysicsSandbox(renderer, physics);

  const loop = new Loop({
    step: () => physics.step(),
    render: (alpha, realDt) => {
      sandbox.update();
      physics.sync(alpha);
      debug?.update(realDt);
      renderer.render();
    },
  });

  const debug = DebugGUI.isEnabled()
    ? new DebugGUI({
        stepper: loop.stepper,
        physics,
        onReset: () => sandbox.resetBoxes(),
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
