import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CameraRig, type CameraController } from '../src/camera/CameraRig';
import { ChaseCam, type ChaseTarget } from '../src/camera/ChaseCam';
import { CutsceneCam } from '../src/camera/CutsceneCam';
import { KillCam } from '../src/camera/KillCam';
import { clamp01, easeInOutCubic, easeOutBack, smoothing } from '../src/camera/easing';
import { CAMERA, CANNON, PENETRATION, PHYSICS, PROJECTILE, XRAY } from '../src/config';
import {
  aimDirection,
  clampAim,
  muzzleSpeed,
  simulateTrajectory,
  trajectoryCapacity,
} from '../src/game/ballistics';
import { penetrationBlasts, penetrationDepth } from '../src/game/penetration';
import { Projectile } from '../src/game/Projectile';
import { GameState, StateMachine, TRANSITIONS } from '../src/game/StateMachine';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const dt = PHYSICS.fixedTimestep;
const { IDLE, CANNON_CUTSCENE, AIMING, PROJECTILE_CAM, IMPACT, SPECTATE } = GameState;

describe('StateMachine', () => {
  it('follows the CLAUDE.md diagram end to end', () => {
    const fsm = new StateMachine();
    for (const s of [CANNON_CUTSCENE, AIMING, PROJECTILE_CAM, IMPACT, SPECTATE]) {
      expect(fsm.transition(s)).toBe(true);
    }
    expect(fsm.transition(CANNON_CUTSCENE)).toBe(true); // 부서진 건물에 재발사
    expect(fsm.state).toBe(CANNON_CUTSCENE);
  });

  it('allows a miss to skip IMPACT and a reset back to IDLE', () => {
    const fsm = new StateMachine(PROJECTILE_CAM);
    expect(fsm.transition(SPECTATE)).toBe(true);
    expect(fsm.transition(IDLE)).toBe(true);
  });

  it('rejects every transition not in the table', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const all = Object.values(GameState);
    for (const from of all) {
      for (const to of all) {
        const fsm = new StateMachine(from);
        expect(fsm.transition(to)).toBe(TRANSITIONS[from].includes(to));
        expect(fsm.state).toBe(TRANSITIONS[from].includes(to) ? to : from);
      }
    }
    warn.mockRestore();
  });

  it('calls exit → enter → change in order, and unsubscribes', () => {
    const fsm = new StateMachine();
    const log: string[] = [];
    fsm.onExit(IDLE, () => log.push('exit IDLE'));
    const off = fsm.onEnter(CANNON_CUTSCENE, (from) => log.push(`enter from ${from}`));
    fsm.onChange((from, to) => log.push(`${from}->${to}`));
    fsm.transition(CANNON_CUTSCENE);
    expect(log).toEqual(['exit IDLE', 'enter from IDLE', 'IDLE->CANNON_CUTSCENE']);
    off();
    const fsm2Log = log.length;
    fsm.transition(AIMING);
    expect(log.length).toBe(fsm2Log + 1); // change만
  });
});

describe('ballistics', () => {
  it('predicted path matches a Rapier projectile step for step', async () => {
    const physics = await PhysicsWorld.create();
    const origin = new Vector3(0, 5, 0);
    const velocity = new Vector3(3, 25, -60);
    const body = physics.add(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, origin.y, origin.z)
        .setLinvel(velocity.x, velocity.y, velocity.z),
      RAPIER.ColliderDesc.ball(PROJECTILE.radius),
    );
    const out = new Float32Array(trajectoryCapacity(dt, 3) * 3);
    const n = simulateTrajectory(origin, velocity, dt, 3, out, -1000);
    for (let i = 1; i < n; i++) {
      physics.step();
      const p = body.currPos;
      expect(
        Math.hypot(p.x - out[i * 3]!, p.y - out[i * 3 + 1]!, p.z - out[i * 3 + 2]!),
      ).toBeLessThan(1e-3);
    }
  });

  it('stops at the ground with an interpolated landing point', () => {
    const out = new Float32Array(trajectoryCapacity(0.05, 10) * 3);
    const n = simulateTrajectory({ x: 0, y: 2, z: 0 }, { x: 0, y: 5, z: 10 }, 0.05, 10, out);
    expect(out[(n - 1) * 3 + 1]).toBe(0);
    for (let i = 0; i < n - 1; i++) expect(out[i * 3 + 1]!).toBeGreaterThanOrEqual(0);
  });

  it('never writes past the buffer', () => {
    const out = new Float32Array(5 * 3);
    expect(simulateTrajectory({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: 1 }, dt, 10, out)).toBe(5);
  });

  it('clamps aim and maps power to speed', () => {
    expect(clampAim(10, 10)).toEqual({ yaw: CANNON.yawLimit, pitch: CANNON.pitchMax });
    expect(clampAim(-10, -10)).toEqual({ yaw: -CANNON.yawLimit, pitch: CANNON.pitchMin });
    expect(muzzleSpeed(0, 40, 120)).toBe(40);
    expect(muzzleSpeed(1, 40, 120)).toBe(120);
    expect(muzzleSpeed(2, 40, 120)).toBe(120);
  });

  it('aim direction is a unit vector pointing along the base yaw', () => {
    const d = { x: 0, y: 0, z: 0 };
    aimDirection(Math.PI, 0, 0, d); // +z에서 -z(건물) 쪽
    expect(d.z).toBeCloseTo(-1);
    aimDirection(Math.PI, 0.3, 0.4, d);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(Math.sin(0.4));
  });
});

describe('easing', () => {
  it('curves start at 0, end at 1, and ease-in-out is monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(clamp01(2)).toBe(1);
  });

  it('smoothing is frame-rate independent', () => {
    const step = (frames: number) => {
      let x = 0;
      for (let i = 0; i < frames; i++) x += (1 - x) * smoothing(1 / frames, 0.3);
      return x;
    };
    expect(step(30)).toBeCloseTo(step(240), 6);
  });
});

describe('cameras', () => {
  const pose = (x: number, y: number, z: number) => ({
    position: new Vector3(x, y, z),
    target: new Vector3(0, 0, 0),
  });

  it('cutscene starts at the current camera and ends exactly at the aim pose', () => {
    const start = new Vector3(0, 20, 50);
    const end = { position: new Vector3(0, 7, 72), target: new Vector3(0, 5, 30) };
    const cut = new CutsceneCam(start, new Vector3(0, 10, 0), new Vector3(0, 0, 1), end);
    const out = pose(0, 0, 0);
    expect(cut.poseAt(0, out).position.distanceTo(start)).toBeLessThan(1e-6);
    cut.poseAt(1, out);
    expect(out.position.distanceTo(end.position)).toBeLessThan(1e-6);
    expect(out.target.distanceTo(end.target)).toBeLessThan(1e-6);
    const cam = new PerspectiveCamera();
    for (let t = 0; t < CAMERA.cutsceneDurationSec + 0.5; t += 0.1) cut.update(0.1, cam, out);
    expect(cut.done).toBe(true);
  });

  it('rig blends from the previous pose to the new controller', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(0, 0, 10);
    const rig = new CameraRig(cam);
    const target: CameraController = {
      update: (_dt, _c, out) => {
        out.position.set(10, 0, 0);
        out.target.set(0, 0, 0);
      },
    };
    rig.setController(target, 1);
    rig.update(1e-4);
    expect(cam.position.distanceTo(new Vector3(0, 0, 10))).toBeLessThan(1e-3);
    for (let i = 0; i < 20; i++) rig.update(0.1);
    expect(rig.blending).toBe(false);
    expect(cam.position.distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-6);
  });

  it('shake offsets the camera but never accumulates into the base pose', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.setController({ update: (_d, _c, out) => out.position.set(0, 5, 10) }, 0);
    rig.shake.add(1);
    for (let i = 0; i < 10; i++) rig.update(0.016);
    expect(cam.position.distanceTo(new Vector3(0, 5, 10))).toBeGreaterThan(0);
    for (let i = 0; i < 200; i++) rig.update(0.016); // 다 잦아든 뒤
    expect(rig.shake.trauma).toBe(0);
    expect(cam.position.distanceTo(new Vector3(0, 5, 10))).toBeLessThan(1e-9);
  });

  it('chase camera settles behind and above a steadily moving target', () => {
    const position = new Vector3();
    const target: ChaseTarget = {
      active: true,
      position,
      velocity: (out) => out.set(0, 0, -50),
    };
    const chase = new ChaseCam();
    chase.start(target, new Vector3(30, 30, 30));
    const out = pose(0, 0, 0);
    const cam = new PerspectiveCamera();
    for (let i = 0; i < 300; i++) {
      position.z -= 50 * 0.016;
      chase.update(0.016, cam, out);
    }
    // 지수 스무딩이라 정상 상태에선 속도 × 시간상수만큼 뒤처진다
    const lag = 50 * CAMERA.chaseSmoothing;
    expect(out.position.x).toBeCloseTo(0, 3);
    expect(out.position.y).toBeCloseTo(CAMERA.chaseUp, 3);
    expect(out.position.z - position.z).toBeCloseTo(CAMERA.chaseBack + lag, 0);
  });
});

describe('Projectile', () => {
  it('reports impact energy ½mv² and does not tunnel through a thin pane', async () => {
    const physics = await PhysicsWorld.create();
    // 유리 두께(3cm)의 판. 120m/s면 한 스텝에 2m를 간다 → CCD 없으면 뚫고 지나간다.
    const pane = physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 5, -20),
      RAPIER.ColliderDesc.cuboid(3, 3, 0.015).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    const projectile = new Projectile(new Scene(), physics);
    projectile.launch(new Vector3(0, 5, 0), new Vector3(0, 0, -PROJECTILE.muzzleSpeedMax));
    let hitEnergy = 0;
    for (let i = 0; i < 30 && hitEnergy === 0; i++) {
      physics.step();
      physics.events.drain((e) => {
        const a = physics.getByCollider(e.collider1);
        const b = physics.getByCollider(e.collider2);
        if (
          e.started &&
          a &&
          b &&
          (projectile.isBody(a) || projectile.isBody(b)) &&
          [a, b].includes(pane)
        ) {
          hitEnergy = projectile.impact()!.energy;
        }
      });
    }
    const v = PROJECTILE.muzzleSpeedMax;
    expect(hitEnergy / (0.5 * PROJECTILE.mass * v * v)).toBeCloseTo(1, 1);
    expect(projectile.position.z).toBeGreaterThan(-20); // 판 앞에서 멈췄다
  });
});

describe('penetration', () => {
  const dir = { x: 0, y: 0, z: -1 };
  const at = { x: 0, y: 10, z: 0 };

  it('weak shots stop at the surface with all their energy', () => {
    const blasts = penetrationBlasts(at, dir, PENETRATION.minEnergy * 0.9, 70);
    expect(blasts).toEqual([{ point: at, energy: PENETRATION.minEnergy * 0.9, delay: 0 }]);
    expect(penetrationDepth(PENETRATION.minEnergy)).toBe(0);
  });

  it('strong shots drill in along the path, conserving energy', () => {
    const energy = 3.6e6; // 120 m/s
    const blasts = penetrationBlasts(at, dir, energy, 120);
    const depth = penetrationDepth(energy);
    expect(depth).toBeCloseTo((energy - PENETRATION.minEnergy) / PENETRATION.energyPerMeter);
    expect(blasts.length).toBe(1 + Math.ceil(depth / PENETRATION.spacing));
    expect(blasts.reduce((s, b) => s + b.energy, 0)).toBeCloseTo(energy, 3);
    expect(blasts[0]!.energy).toBeCloseTo(energy * PENETRATION.contactShare);
    const last = blasts[blasts.length - 1]!;
    expect(last.point.z).toBeCloseTo(-depth); // 깊이 끝
    for (let i = 1; i < blasts.length; i++) {
      expect(blasts[i]!.delay).toBeGreaterThan(blasts[i - 1]!.delay); // 순서대로 터진다
      if (i > 1) expect(blasts[i]!.energy).toBeLessThan(blasts[i - 1]!.energy); // 깊을수록 약하게
    }
  });

  it('depth is capped and never goes underground', () => {
    expect(penetrationDepth(1e12)).toBe(PENETRATION.maxDepth);
    const down = { x: 0, y: -0.6, z: -0.8 };
    for (const b of penetrationBlasts({ x: 0, y: 2, z: 0 }, down, 3.6e6, 120)) {
      expect(b.point.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('KillCam', () => {
  const shell: ChaseTarget = { active: true, position: new Vector3(0, 10, 5), velocity: (o) => o };

  it('watches the path from the side the camera came from', () => {
    for (const fromX of [40, -40]) {
      const cam = new KillCam();
      const contact = new Vector3(0, 10, 0);
      const dir = new Vector3(0, 0, -1);
      cam.start(contact, dir, 6, new Vector3(fromX, 20, 30), shell);
      const out = { position: new Vector3(), target: new Vector3() };
      cam.update(0, new PerspectiveCamera(), out);
      expect(Math.sign(out.position.x)).toBe(Math.sign(fromX)); // 반대편으로 뒤집히지 않는다
      // 경로 중심에서 대략 camDistance + 깊이/2 떨어져 있다
      const center = new Vector3(0, 10, -3);
      const dist = out.position.distanceTo(center);
      expect(dist).toBeGreaterThan(XRAY.camDistance);
      expect(dist).toBeLessThan((XRAY.camDistance + 3) * 1.5);
      // 시선은 경로 중심과 포탄 사이
      expect(out.target.z).toBeGreaterThan(center.z);
      expect(out.target.z).toBeLessThan(shell.position.z);
    }
  });
});
