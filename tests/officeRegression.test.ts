// Phase 7-4 office 회귀: 재질 테이블·아키타입·재질별 배치 리팩터링 전에 잰 값과 같아야 한다.
// 같은 seed office 건물의 조각·그래프·질량·가치·한 번 폭발 뒤 분리 수를 비교한다.
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability } from '../src/destruction/Durability';
import { FireSystem } from '../src/destruction/FireSystem';
import { Economy } from '../src/economy/Economy';
import { MATERIAL } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;

/** 7-4 리팩터링 전 (b2c80b1) 값 */
const BASELINE = {
  fragments: 808,
  volume: 412.790176,
  edges: 2639,
  capacity: 46917306.312017,
  mass: 991144.321901,
  value: 4794.163288,
  fuel: 9122,
  durability: 306,
  detached: 24,
  money: 82.311444,
};

async function measure() {
  const b = generateBuilding({
    ...DEFAULT_BUILDING,
    floors: 3,
    baysX: 2,
    baysZ: 2,
    windowRatio: 0.6,
  });
  const counts = allocateSeeds(b.members, 900);
  const rng = createRng(33);
  const frags = runFracture({
    jobs: b.members.map((m, i) => ({
      box: m.box,
      seeds: memberSeeds(m, counts[i]!, rng),
      material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
    })),
  });
  const physics = await PhysicsWorld.create();
  physics.add(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    RAPIER.ColliderDesc.cuboid(100, 0.5, 100),
  );
  const member = (i: number) => b.members[frags[i]!.member]!;
  const system = new DestructionSystem(
    new Scene(),
    physics,
    frags,
    createFragmentMaterials(),
    (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
    0,
    false,
    Durability.initial(
      frags.length,
      (i) => member(i).kind,
      (i) => member(i).anchor,
      33,
    ),
  );
  const economy = new Economy();
  economy.attach(
    system,
    {
      count: frags.length,
      mass: system.graph.mass,
      kind: (i) => member(i).kind,
      material: (i) => (frags[i]!.material === MATERIAL.glass ? 'glass' : 'concrete'),
      durability: (i) => system.durability.max[i]!,
    },
    33,
  );
  const fuel = FireSystem.fuelFor(
    system.graph,
    (i) => member(i).kind,
    () => 0.5,
  );
  const g = system.graph;
  const sum = (a: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i]!;
    return s;
  };
  const value = economy.ledger!.totalValue;
  system.detonate(new Vector3(0, 4, 6.3), 1.6e6, createRng(1));
  for (let t = 0; t < 2; t += dt) {
    physics.step();
    system.step(dt);
  }
  let detached = 0;
  for (let i = 0; i < g.nodeCount; i++) if (!g.attached[i]) detached++;
  return {
    fragments: frags.length,
    volume: frags.reduce((a, f) => a + f.volume, 0),
    edges: g.edgeCount,
    capacity: sum(g.capacity),
    mass: sum(g.mass),
    value,
    fuel: sum(fuel),
    durability: sum(system.durability.max),
    detached,
    money: economy.wallet.money,
  };
}

describe('office regression (Phase 7-4 refactor)', () => {
  it('same seed office → same fragments, graph, mass, value, fuel and blast result', async () => {
    const r = await measure();
    expect(r.fragments).toBe(BASELINE.fragments);
    expect(r.edges).toBe(BASELINE.edges);
    expect(r.detached).toBe(BASELINE.detached);
    expect(r.volume).toBeCloseTo(BASELINE.volume, 6);
    for (const k of ['capacity', 'mass', 'value', 'fuel', 'durability', 'money'] as const) {
      expect(r[k] / BASELINE[k]).toBeCloseTo(1, 6);
    }
  });
});
