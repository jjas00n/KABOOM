// 조각 내구도 (6++): 직접 타격에는 버티고 내구도만 깎이며, 지지 상실에는 떨어진다.
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { StructureGraph } from '../src/building/StructureGraph';
import { DURABILITY, PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability, NOT_PROTECTED } from '../src/destruction/Durability';
import { breakInBlast } from '../src/destruction/Explosion';
import { BuildingLedger } from '../src/economy/BuildingLedger';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;
const PER = DURABILITY.energyPerPoint;
const MIN = DURABILITY.minHitEnergy;

describe('Durability model', () => {
  it('a fragment with durability N survives N hard hits and breaks on the N+1-th', () => {
    for (const n of [1, 2, 3]) {
      const d = new Durability(Uint8Array.from([n]));
      for (let k = 0; k < n; k++) {
        expect(d.hit(0, PER * 0.9, d.begin(), PER, MIN)).toBe(1); // 버티고 1 감소
      }
      expect(d.current[0]).toBe(0);
      expect(d.hit(0, PER * 0.9, d.begin(), PER, MIN)).toBe(NOT_PROTECTED);
    }
  });

  it('loses ceil(energy / energyPerPoint) per hit, at least 1, never below 0', () => {
    const d = new Durability(Uint8Array.from([5]));
    expect(d.hit(0, PER * 2.1, d.begin(), PER, MIN)).toBe(3);
    expect(d.hit(0, PER * 10, d.begin(), PER, MIN)).toBe(2); // 남은 만큼만
    expect(d.current[0]).toBe(0);
  });

  it('weak hits hold without losing durability; zero-durability fragments are never protected', () => {
    const d = new Durability(Uint8Array.from([2, 0]));
    expect(d.hit(0, MIN * 0.5, d.begin(), PER, MIN)).toBe(0);
    expect(d.current[0]).toBe(2);
    expect(d.hit(1, PER * 5, d.begin(), PER, MIN)).toBe(NOT_PROTECTED);
  });

  it('counts a fragment once per blast even if asked repeatedly', () => {
    const d = new Durability(Uint8Array.from([3]));
    const round = d.begin();
    expect(d.hit(0, PER * 0.9, round, PER, MIN)).toBe(1);
    expect(d.hit(0, PER * 0.9, round, PER, MIN)).toBe(1); // 같은 결과, 추가 감소 없음
    expect(d.current[0]).toBe(2);
    expect(d.protectedIn(0, round)).toBe(true);
  });

  it('initial values follow member kind with seed-deterministic jitter, plus the building bonus', () => {
    const kinds = ['wallPanel', 'glass', 'slab', 'beam', 'column', 'foundation'];
    const kind = (i: number) => kinds[i % kinds.length]!;
    const anchor = (i: number) => kind(i) === 'foundation';
    const a = Durability.initial(600, kind, anchor, 7);
    expect(Array.from(Durability.initial(600, kind, anchor, 7))).toEqual(Array.from(a));
    for (let i = 0; i < 600; i++) {
      const base = DURABILITY.byKind[kind(i)] ?? 0;
      if (base === 0 || anchor(i)) expect(a[i]).toBe(0);
      else expect(Math.abs(a[i]! - base)).toBeLessThanOrEqual(1);
    }
    const columns = Array.from(a).filter((_, i) => kind(i) === 'column');
    expect(new Set(columns).size).toBeGreaterThan(1); // 같은 부재 안에서도 조금씩 다르다
    const bonus = Durability.initial(600, kind, anchor, 7, 2);
    for (let i = 0; i < 600; i++) {
      if (a[i]! > 0) expect(bonus[i]).toBe(a[i]! + 2);
      else if ((DURABILITY.byKind[kind(i)] ?? 0) === 0) expect(bonus[i]).toBe(0);
    }
  });
});

/** 손으로 만든 줄: 앵커 0 — 1 — 2 — 3 (x로 1m 간격) */
function line(count: number) {
  const frags = Array.from(
    { length: count },
    (_, i) =>
      ({
        centroid: { x: i, y: 0, z: 0 },
        volume: 0.1,
        material: MATERIAL.concrete,
        member: i,
        neighbors: [i - 1, i + 1].filter((j) => j >= 0 && j < count),
        neighborAreas: [i - 1, i + 1].filter((j) => j >= 0 && j < count).map(() => 0.2),
      }) as unknown as Fragment,
  );
  const graph = StructureGraph.fromFragments(frags, (i) => ({ anchor: i === 0, cladding: false }));
  return { graph, positions: new Float64Array(frags.flatMap((f) => [f.centroid.x, 0, 0])) };
}

describe('blasts with durability', () => {
  it('zero-durability fragments break exactly as before (same detached set and edges)', () => {
    const a = line(8);
    const b = line(8);
    const center = { x: 4, y: 0, z: 0 };
    const plain = breakInBlast(a.graph, a.positions, center, 2.2);
    const d = new Durability(new Uint8Array(8));
    const round = d.begin();
    const guarded = breakInBlast(
      b.graph,
      b.positions,
      center,
      2.2,
      undefined,
      (i) => d.hit(i, PER, round, PER, MIN) >= 0,
    );
    expect(guarded).toEqual(plain);
    expect(Array.from(b.graph.alive)).toEqual(Array.from(a.graph.alive));
  });

  it('a held fragment is not detached and keeps its joints', () => {
    const { graph, positions } = line(8);
    // 4와 5는 내구도 블록, 3은 0
    const d = new Durability(Uint8Array.from([0, 0, 0, 0, 2, 2, 0, 0]));
    const round = d.begin();
    const out = breakInBlast(
      graph,
      positions,
      { x: 4, y: 0, z: 0 },
      2.2,
      undefined,
      (i) => d.hit(i, PER, round, PER, MIN) >= 0,
    );
    expect(out).not.toContain(4);
    expect(graph.attached[4]).toBe(1);
    expect(out).toContain(3); // 이웃(내구도 0)은 그대로 깨진다 (그 조각과의 연결은 같이 사라짐)
    // 버틴 조각끼리의 연결(4-5)은 폭발 반경 안이어도 끊기지 않는다
    let joint = -1;
    for (let k = graph.incidentStart[4]!; k < graph.incidentStart[5]!; k++) {
      if (graph.other(graph.incident[k]!, 4) === 5) joint = graph.incident[k]!;
    }
    expect(graph.alive[joint]).toBe(1);
    expect(d.current[4]).toBe(1);
  });
});

/** 고정 seed 소형 건물 (게임과 같은 내구도) */
async function building() {
  const b = generateBuilding({ ...DEFAULT_BUILDING, floors: 3, baysX: 2, baysZ: 2 });
  const counts = allocateSeeds(b.members, 700);
  const rng = createRng(21);
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
    true,
    Durability.initial(
      frags.length,
      (i) => member(i).kind,
      (i) => member(i).anchor,
      21,
    ),
  );
  const run = (sec: number) => {
    for (let t = 0; t < sec; t += dt) {
      physics.step();
      system.step(dt);
    }
  };
  const at = (i: number) =>
    new Vector3(frags[i]!.centroid.x, frags[i]!.centroid.y, frags[i]!.centroid.z);
  return { system, frags, member, run, at };
}

describe('durability in a real building', () => {
  it('a column fragment takes max+1 direct hits; the finale (ignoreDurability) breaks it at once', async () => {
    const s = await building();
    const column = s.frags.findIndex(
      (_, i) => s.member(i).kind === 'column' && s.system.durability.max[i]! >= 2,
    );
    expect(column).toBeGreaterThanOrEqual(0);
    const max = s.system.durability.max[column]!;
    const energy = PER * 0.9; // 폭심에서 1씩 깎이는 세기
    for (let k = 0; k < max; k++) {
      s.system.detonate(s.at(column), energy, createRng(k));
      expect(s.system.graph.attached[column]).toBe(1);
      expect(s.system.fragments.chunkOf[column]!.body.rigidBody.isFixed()).toBe(true);
    }
    expect(s.system.durability.current[column]).toBe(0);
    s.system.detonate(s.at(column), energy, createRng(9));
    expect(s.system.graph.attached[column]).toBe(0);

    // 피날레: 내구도가 남은 다른 기둥도 한 번에
    const other = s.frags.findIndex(
      (_, i) => s.member(i).kind === 'column' && s.system.durability.current[i]! >= 2,
    );
    s.system.detonate(s.at(other), energy, createRng(1), undefined, true);
    expect(s.system.graph.attached[other]).toBe(0);
  });

  it('durable fragments still fall when they lose support (no floating blocks)', async () => {
    const s = await building();
    const g = s.system.graph;
    // 1층 기둥 전부를 내구도 무시로 떼어낸다 → 위의 슬래브·보(내구도 있음)가 받침을 잃는다
    const ground = s.frags
      .map((_, i) => i)
      .filter((i) => s.member(i).kind === 'column' && s.frags[i]!.centroid.y < 3.5);
    for (const i of ground) s.system.detonate(s.at(i), 2e4, createRng(i), undefined, true);
    s.run(3);
    const upper = s.frags
      .map((_, i) => i)
      .filter((i) => s.system.durability.max[i]! > 0 && s.frags[i]!.centroid.y > 4.5);
    expect(upper.length).toBeGreaterThan(0);
    const fell = upper.filter((i) => !g.attached[i]).length;
    expect(fell / upper.length).toBeGreaterThan(0.9);
  });

  it('pays more for durable fragments, and nothing when only durability is lost', () => {
    const nodes = {
      count: 2,
      mass: [1000, 1000],
      kind: () => 'column',
      material: () => 'concrete',
      durability: (i: number) => (i === 0 ? 0 : 2),
    };
    const ledger = new BuildingLedger(nodes, 1, false);
    expect(ledger.baseValue[1]).toBeCloseTo(
      ledger.baseValue[0]! * (1 + 2 * DURABILITY.valuePerPoint),
    );
    expect(ledger.paidAmount).toBe(0); // 지급은 분리될 때만 (release)
  });
});
