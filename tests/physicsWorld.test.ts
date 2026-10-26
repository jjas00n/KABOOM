import RAPIER from '@dimforge/rapier3d-compat';
import { Object3D } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

function addGround(physics: PhysicsWorld) {
  return physics.add(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    RAPIER.ColliderDesc.cuboid(10, 0.5, 10),
  );
}

function addBall(physics: PhysicsWorld, y: number, target: Object3D | null = null) {
  return physics.add(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, y, 0),
    RAPIER.ColliderDesc.ball(0.5).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    target,
  );
}

describe('PhysicsWorld', () => {
  let physics: PhysicsWorld;

  beforeEach(async () => {
    physics = await PhysicsWorld.create();
  });

  it('dynamic bodies fall under gravity', () => {
    const ball = addBall(physics, 5);
    for (let i = 0; i < 10; i++) physics.step();
    expect(ball.currPos.y).toBeLessThan(5);
    expect(ball.prevPos.y).toBeGreaterThan(ball.currPos.y);
  });

  it('queues a started collision event on ground contact', () => {
    const ground = addGround(physics);
    const ball = addBall(physics, 2);
    for (let i = 0; i < 120; i++) physics.step();

    const started: [number, number][] = [];
    physics.events.drain((e) => {
      if (e.started) started.push([e.collider1, e.collider2]);
    });
    expect(started.length).toBeGreaterThan(0);
    const pair = started[0]!.slice().sort();
    expect(pair).toEqual([ground.collider.handle, ball.collider.handle].sort());
    expect(physics.events.length).toBe(0);
  });

  it('remove() drops the body and its collider lookup', () => {
    addGround(physics);
    const ball = addBall(physics, 2);
    expect(physics.bodyCount).toBe(2);
    physics.remove(ball);
    expect(physics.bodyCount).toBe(1);
    expect(physics.has(ball)).toBe(false);
    expect(physics.getByCollider(ball.collider.handle)).toBeUndefined();
  });

  it('sync() interpolates between previous and current state', () => {
    const target = new Object3D();
    const ball = addBall(physics, 5, target);
    for (let i = 0; i < 10; i++) physics.step();

    physics.sync(0.5);
    const { prevPos, currPos } = ball;
    expect(target.position.y).toBeCloseTo((prevPos.y + currPos.y) / 2);
    expect(target.position.y).toBeLessThan(prevPos.y);
    expect(target.position.y).toBeGreaterThan(currPos.y);
  });

  it('removeBelow() removes bodies under the kill height', () => {
    const ball = addBall(physics, 0);
    for (let i = 0; i < 120; i++) physics.step();
    const removed: unknown[] = [];
    physics.removeBelow(-5, (b) => removed.push(b));
    expect(removed).toEqual([ball]);
    expect(physics.bodyCount).toBe(0);
  });
});
