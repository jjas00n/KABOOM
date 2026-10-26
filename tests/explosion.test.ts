import RAPIER from '@dimforge/rapier3d-compat';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONCRETE } from '../src/config';
import { applyExplosion } from '../src/destruction/Explosion';
import { buildFragments } from '../src/fracture/Fragment';
import { boxPolyhedron } from '../src/fracture/polyhedron';
import { createRng, uniformSeeds } from '../src/fracture/seeds';
import { voronoiCells } from '../src/fracture/voronoi';
import { PhysicsWorld, type PhysicsBody } from '../src/physics/PhysicsWorld';

const BOX = { min: { x: -1, y: 0, z: -1 }, max: { x: 1, y: 2, z: 1 } };

describe('fragments as Rapier bodies', () => {
  let physics: PhysicsWorld;
  let bodies: PhysicsBody[];

  beforeEach(async () => {
    physics = await PhysicsWorld.create();
    const cells = voronoiCells(
      boxPolyhedron(BOX.min, BOX.max),
      uniformSeeds(BOX, 40, createRng(5)),
    );
    bodies = buildFragments(cells).map((f) => {
      const desc = RAPIER.ColliderDesc.convexHull(f.hull);
      expect(desc).not.toBeNull();
      return physics.add(
        RAPIER.RigidBodyDesc.fixed().setTranslation(f.centroid.x, f.centroid.y, f.centroid.z),
        desc!.setDensity(CONCRETE.density),
      );
    });
  });

  it('fixed fragments stay put under gravity', () => {
    for (let i = 0; i < 60; i++) physics.step();
    for (const b of bodies) expect(b.rigidBody.isFixed()).toBe(true);
  });

  it('total hull mass matches box volume × density once dynamic', () => {
    for (const b of bodies) b.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const mass = bodies.reduce((s, b) => s + b.rigidBody.mass(), 0);
    expect(mass / (8 * CONCRETE.density)).toBeCloseTo(1, 2);
  });

  it('explosion pushes dynamic fragments away from the center', () => {
    for (const b of bodies) b.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const center = { x: 0, y: 1, z: 1.5 };
    const before = bodies.map((b) => b.currPos.distanceTo(center));
    const hit = applyExplosion(bodies, center, { radius: 3, peakDeltaV: 10, random: () => 0.5 });
    expect(hit).toBe(bodies.length);
    for (let i = 0; i < 10; i++) physics.step();
    const moved = bodies.filter((b, i) => b.currPos.distanceTo(center) > before[i]!).length;
    expect(moved / bodies.length).toBeGreaterThan(0.9);
  });

  it('explosion ignores fixed bodies and bodies outside the radius', () => {
    expect(applyExplosion(bodies, { x: 0, y: 1, z: 0 }, { radius: 3 })).toBe(0);
    for (const b of bodies) b.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    expect(applyExplosion(bodies, { x: 100, y: 0, z: 0 }, { radius: 3 })).toBe(0);
  });
});
