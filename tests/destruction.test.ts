import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Scene, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { BUILDING, PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { FragmentSet } from '../src/destruction/FragmentSet';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng, uniformSeeds } from '../src/fracture/seeds';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;

function worldPos(set: FragmentSet, f: number): Vector3 {
  const chunk = set.chunkOf[f]!;
  const k = chunk.frags.indexOf(f);
  return chunk.offsets[k]!.clone().applyQuaternion(chunk.body.currQuat).add(chunk.body.currPos);
}

describe('FragmentSet chunks', () => {
  let physics: PhysicsWorld;
  let frags: Fragment[];
  let set: FragmentSet;

  beforeEach(async () => {
    physics = await PhysicsWorld.create();
    const box = { min: { x: 0, y: 5, z: 0 }, max: { x: 2, y: 6, z: 1 } };
    frags = runFracture({ jobs: [{ box, seeds: uniformSeeds(box, 20, createRng(2)) }] });
    set = new FragmentSet(new Scene(), physics, frags, createFragmentMaterials());
  });

  it('merge keeps every fragment where it was and makes one dynamic body', () => {
    const all = frags.map((_, i) => i);
    const chunk = set.merge(all);
    expect(chunk.body.rigidBody.isDynamic()).toBe(true);
    expect(physics.bodyCount).toBe(1);
    for (const i of all) {
      const c = frags[i]!.centroid;
      expect(worldPos(set, i).distanceTo(new Vector3(c.x, c.y, c.z))).toBeLessThan(1e-4);
    }
  });

  it('split keeps world poses and inherits rigid-body velocity', () => {
    const all = frags.map((_, i) => i);
    const chunk = set.merge(all);
    const rb = chunk.body.rigidBody;
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.7);
    rb.setRotation(q, true);
    rb.setTranslation({ x: 3, y: 4, z: 5 }, true);
    rb.setLinvel({ x: 1, y: -2, z: 0.5 }, true);
    rb.setAngvel({ x: 0, y: 2, z: 0 }, true);
    chunk.body.snap();
    const before = all.map((i) => worldPos(set, i));
    const origin = chunk.body.currPos.clone();

    const parts = set.split(chunk, [all.slice(0, 10), ...all.slice(10).map((i) => [i])]);
    expect(parts).toHaveLength(1 + (all.length - 10));
    all.forEach((i, k) => expect(worldPos(set, i).distanceTo(before[k]!)).toBeLessThan(1e-4));
    for (const part of parts) {
      const r = part.body.currPos.clone().sub(origin);
      const expected = new Vector3(0, 2, 0).cross(r).add(new Vector3(1, -2, 0.5));
      const v = part.body.rigidBody.linvel();
      expect(new Vector3(v.x, v.y, v.z).distanceTo(expected)).toBeLessThan(1e-3);
    }
  });

  it('removeChunk drops the body and clears fragment lookup', () => {
    const chunk = set.chunkOf[0]!;
    set.removeChunk(chunk);
    expect(set.chunkOf[0]).toBeNull();
    expect(chunk.body.alive).toBe(false);
  });
});

describe('DestructionSystem', () => {
  let physics: PhysicsWorld;
  let system: DestructionSystem;
  let frags: Fragment[];
  const building = generateBuilding({ ...DEFAULT_BUILDING, floors: 2, baysX: 2, baysZ: 2 });

  beforeEach(async () => {
    physics = await PhysicsWorld.create();
    physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50),
    );
    const counts = allocateSeeds(building.members, 500);
    const rng = createRng(4);
    frags = runFracture({
      jobs: building.members.map((m, i) => ({
        box: m.box,
        seeds: memberSeeds(m, counts[i]!, rng),
        material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
      })),
    });
    const member = (i: number) => building.members[frags[i]!.member]!;
    system = new DestructionSystem(new Scene(), physics, frags, createFragmentMaterials(), (i) => ({
      anchor: member(i).anchor,
      cladding: CLADDING.includes(member(i).kind),
    }));
  });

  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      physics.step();
      system.step(dt);
    }
  };

  it('a blast detaches the core and makes those fragments dynamic', () => {
    const { min, max } = building.footprint;
    system.detonate({ x: (min.x + max.x) / 2, y: 2, z: max.z }, 1e6);
    expect(physics.movingCount).toBeGreaterThan(0);
    run(0.2);
    expect(system.graph.attached.some((a, i) => !a && !system.graph.anchor[i])).toBe(true);
  });

  it('blowing every ground column drops the upper floors as falling chunks', () => {
    const { min, max } = building.footprint;
    const { baysX, baysZ } = DEFAULT_BUILDING;
    const half = BUILDING.columnSize / 2;
    const xs = Array.from(
      { length: 3 },
      (_, i) => min.x + half + (i * (max.x - min.x - 2 * half)) / 2,
    );
    const zs = Array.from(
      { length: 3 },
      (_, j) => min.z + half + (j * (max.z - min.z - 2 * half)) / 2,
    );
    expect(baysX + baysZ).toBeGreaterThan(0);
    for (const x of xs) for (const z of zs) system.detonate({ x, y: 2, z }, 2e4);
    run(0.1);
    expect(system.stats.islands).toBeGreaterThan(0);
    // 위층 슬래브 조각은 더 이상 서 있는 구조가 아니다
    const slabUp = frags.findIndex(
      (f) => building.members[f.member]!.kind === 'slab' && f.centroid.y > 6,
    );
    expect(system.graph.attached[slabUp]).toBe(0);
    expect(system.fragments.chunkOf[slabUp]!.body.rigidBody.isDynamic()).toBe(true);
  });

  it('a heavy fast body breaks the standing fragment it hits (chain)', () => {
    const { min, max } = building.footprint;
    const target = { x: (min.x + max.x) / 2, y: 2, z: max.z };
    physics.add(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(target.x, target.y, target.z + 3)
        .setLinvel(0, 0, -40)
        .setCcdEnabled(true),
      RAPIER.ColliderDesc.ball(0.4)
        .setDensity(2000)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    );
    run(0.3);
    expect(system.stats.chainBreaks).toBeGreaterThan(0);
  });
});
