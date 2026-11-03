// Phase 7-4 입문 건물: 아키타입별로 부재가 겹치지 않고, 조각 수가 예산 안이고, 앵커에서 전부 이어지고,
// 자중으로는 무너지지 않는다. 재질 배치는 건물당 4개 이하.
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { buildArchetype, TINY_ARCHETYPES, type Archetype } from '../src/building/archetypes';
import { DEFAULT_BUILDING } from '../src/building/BuildingGenerator';
import { memberPolyhedron, type Member } from '../src/building/Member';
import { memberSeeds, seedCountsForPreset } from '../src/building/seedBudget';
import { MATERIALS, ORDERS, PHYSICS, STRUCTURE, type QualityPreset } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability } from '../src/destruction/Durability';
import { materialId } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { clipPolyhedron, volumeAndCentroid, type Polyhedron } from '../src/fracture/polyhedron';
import { createRng } from '../src/fracture/seeds';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const SEEDS = [1, 7, 42];
const CLADDING: readonly string[] = STRUCTURE.cladding;
const TINY_BUDGET = ORDERS.tiers.tiny.budgetScale;

function params(archetype: Archetype, seed: number) {
  return { ...DEFAULT_BUILDING, archetype, seed };
}

/** 두 볼록 다면체 교집합 부피 (A를 B의 면 평면으로 자른다) */
function overlapVolume(a: Polyhedron, b: Polyhedron): number {
  let p: Polyhedron | null = a;
  for (const f of b.faces) {
    p = clipPolyhedron(p, f.nx, f.ny, f.nz, f.d, -1);
    if (!p) return 0;
  }
  return volumeAndCentroid(p).volume;
}

function fracture(members: readonly Member[], seed: number, preset: QualityPreset) {
  const counts = seedCountsForPreset(members, preset, TINY_BUDGET, ORDERS.tinyMaxFragments);
  const rng = createRng(seed);
  return runFracture({
    jobs: members.map((m, i) => ({
      box: m.box,
      planes: m.planes,
      grain: m.grain,
      seeds: memberSeeds(m, counts[i]!, rng),
      material: materialId(m.material),
    })),
  });
}

describe.each(TINY_ARCHETYPES)('tiny archetype %s', (archetype) => {
  it.each(SEEDS)('seed %i: size, anchors and materials', (seed) => {
    const b = buildArchetype(params(archetype, seed));
    expect(b.height).toBeGreaterThanOrEqual(1.5);
    expect(b.height).toBeLessThanOrEqual(4);
    const anchors = b.members.filter((m) => m.anchor);
    expect(anchors.length).toBeGreaterThan(0);
    for (const m of anchors) {
      expect(m.kind).toBe('foundation');
      expect(m.box.min.y).toBeCloseTo(0, 9);
      expect(m.box.max.y).toBeLessThanOrEqual(0.6); // 얇은 받침
    }
    // 재질 배치: 불투명 재질 2개(외면·단면), 판재 1개 → 건물당 4개 이하
    const materials = new Set(b.members.map((m) => m.material));
    let batches = 0;
    for (const name of materials) batches += MATERIALS[name].pane ? 1 : 2;
    expect(batches).toBeLessThanOrEqual(4);
  });

  it.each(SEEDS)('seed %i: members do not overlap', (seed) => {
    const { members } = buildArchetype(params(archetype, seed));
    const polys = members.map(memberPolyhedron);
    const eps = 1e-6;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!.box;
        const c = members[j]!.box;
        if (
          a.max.x <= c.min.x + eps ||
          c.max.x <= a.min.x + eps ||
          a.max.y <= c.min.y + eps ||
          c.max.y <= a.min.y + eps ||
          a.max.z <= c.min.z + eps ||
          c.max.z <= a.min.z + eps
        ) {
          continue;
        }
        const v = overlapVolume(polys[i]!, polys[j]!);
        if (v > 1e-7)
          throw new Error(
            `members ${i} (${members[i]!.kind}) and ${j} (${members[j]!.kind}) overlap: ${v}`,
          );
      }
    }
  });

  it.each(SEEDS)(
    'seed %i: fragment budget per preset and every fragment connected to an anchor',
    (seed) => {
      const { members } = buildArchetype(params(archetype, seed));
      const counts: Record<string, number> = {};
      for (const preset of ['low', 'medium', 'high'] as const) {
        counts[preset] = fracture(members, seed, preset).length;
      }
      expect(counts.low).toBeGreaterThanOrEqual(120);
      expect(counts.low).toBeLessThan(counts.medium!);
      expect(counts.medium).toBeLessThan(counts.high!);
      expect(counts.high).toBeLessThanOrEqual(650);

      const frags = fracture(members, seed, 'medium');
      const seen = new Uint8Array(frags.length);
      const queue: number[] = [];
      frags.forEach((f, i) => {
        if (members[f.member]!.anchor) {
          seen[i] = 1;
          queue.push(i);
        }
      });
      while (queue.length > 0) {
        const i = queue.pop()!;
        for (const j of frags[i]!.neighbors) {
          if (!seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      const lost = frags.filter((_, i) => !seen[i]).map((f) => members[f.member]!.kind);
      expect(lost).toEqual([]);
    },
  );

  it('stands under its own weight (no detachment in 3 s without a hit)', async () => {
    const seed = 7;
    const { members } = buildArchetype(params(archetype, seed));
    const frags = fracture(members, seed, 'medium');
    const physics = await PhysicsWorld.create();
    physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
      RAPIER.ColliderDesc.cuboid(50, 0.5, 50),
    );
    const member = (i: number) => members[frags[i]!.member]!;
    const system = new DestructionSystem(
      new Scene(),
      physics,
      frags,
      createFragmentMaterials(),
      (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
      0,
      true,
      Durability.initial(
        frags.length,
        (i) => member(i).kind,
        (i) => member(i).anchor,
        seed,
      ),
    );
    expect(system.graph.solveSupport()).toBe(frags.length);
    for (let t = 0; t < 3; t += PHYSICS.fixedTimestep) {
      physics.step();
      system.step(PHYSICS.fixedTimestep);
    }
    let detached = 0;
    for (let i = 0; i < frags.length; i++) if (!system.graph.attached[i]) detached++;
    expect(detached).toBe(0);
    // 입문 건물은 내구도가 전부 0
    expect(Math.max(...system.durability.max)).toBe(0);
  });
});
