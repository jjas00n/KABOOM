import RAPIER from '@dimforge/rapier3d-compat';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEBRIS, PHYSICS } from '../src/config';
import { DebrisManager, type DebrisPolicy } from '../src/destruction/DebrisManager';
import { PhysicsWorld, type PhysicsBody } from '../src/physics/PhysicsWorld';

const POLICY: DebrisPolicy = { ...DEBRIS, maxDynamicFragments: 3 };
const dt = PHYSICS.fixedTimestep;

describe('DebrisManager', () => {
  let physics: PhysicsWorld;
  let removed: PhysicsBody[];
  let debris: DebrisManager;

  const ground = () =>
    physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
      RAPIER.ColliderDesc.cuboid(20, 0.5, 20),
    );
  /** fixed로 만들고 setDynamic → debris 등록 (조각 activate 흐름과 동일) */
  const fragment = (x: number, y: number, size = 0.25) => {
    const body = physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, 0),
      RAPIER.ColliderDesc.cuboid(size, size, size),
    );
    physics.setDynamic(body);
    debris.add(body, 8 * size ** 3);
    return body;
  };
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      physics.step();
      debris.step(dt);
    }
  };

  beforeEach(async () => {
    physics = await PhysicsWorld.create();
    removed = [];
    debris = new DebrisManager(physics, { onRemove: (b) => removed.push(b) }, POLICY);
    ground();
  });

  it('freezes a fragment once it has come to rest on the ground', () => {
    const body = fragment(0, 2);
    run(0.3);
    expect(body.rigidBody.isDynamic()).toBe(true); // 아직 떨어지는 중
    run(3);
    expect(body.rigidBody.isFixed()).toBe(true);
    expect(body.currPos.y).toBeCloseTo(0.25, 1);
    expect(debris.count).toBe(0);
    expect(physics.movingCount).toBe(0);
  });

  it('keeps a fast-moving fragment dynamic', () => {
    const body = fragment(0, 50);
    run(1);
    expect(body.rigidBody.isDynamic()).toBe(true);
    expect(debris.count).toBe(1);
  });

  it('removes the smallest fragments first when over the cap', () => {
    const sizes = [0.3, 0.1, 0.4, 0.2, 0.5];
    const bodies = sizes.map((s, i) => fragment(i * 2, 3, s));
    expect(debris.enforceCap()).toBe(2);
    expect(new Set(removed)).toEqual(new Set([bodies[1], bodies[3]]));
    for (const b of removed) expect(b.alive).toBe(false);
    expect(debris.count).toBe(3);
  });

  it('forgets fragments removed elsewhere (e.g. kill height)', () => {
    const body = fragment(0, 2);
    physics.remove(body);
    run(dt);
    expect(debris.count).toBe(0);
  });

  it('applies damping on registration', () => {
    const body = fragment(0, 2);
    expect(body.rigidBody.linearDamping()).toBeCloseTo(DEBRIS.linearDamping);
    expect(body.rigidBody.angularDamping()).toBeCloseTo(DEBRIS.angularDamping);
  });
});

describe('PhysicsWorld moving set', () => {
  it('setFixed freezes in place and syncs the final pose once', async () => {
    const physics = await PhysicsWorld.create();
    const body = physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, 5, 0),
      RAPIER.ColliderDesc.ball(0.5),
    );
    expect(physics.movingCount).toBe(0);
    physics.setDynamic(body);
    for (let i = 0; i < 10; i++) physics.step();
    const y = body.currPos.y;
    expect(y).toBeLessThan(5);
    physics.setFixed(body);
    for (let i = 0; i < 10; i++) physics.step();
    expect(body.rigidBody.translation().y).toBeCloseTo(y);
    expect(physics.movingCount).toBe(0);
  });
});
