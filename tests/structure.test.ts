import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import type { Member } from '../src/building/Member';
import { StructureGraph } from '../src/building/StructureGraph';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { BUILDING, STRUCTURE } from '../src/config';
import { CollapseSolver } from '../src/destruction/CollapseSolver';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';

const CLADDING: readonly string[] = STRUCTURE.cladding;

function fracturedBuilding(floors = 3) {
  const { members } = generateBuilding({ ...DEFAULT_BUILDING, floors, baysX: 2, baysZ: 2 });
  const counts = allocateSeeds(members, 900);
  const rng = createRng(5);
  const frags: Fragment[] = runFracture({
    jobs: members.map((m, i) => ({
      box: m.box,
      seeds: memberSeeds(m, counts[i]!, rng),
      material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
    })),
  });
  const memberOf = (i: number): Member => members[frags[i]!.member]!;
  const graph = StructureGraph.fromFragments(frags, (i) => ({
    anchor: memberOf(i).anchor,
    cladding: CLADDING.includes(memberOf(i).kind),
  }));
  return { members, frags, graph, memberOf };
}

const isGroundColumn = (m: Member) =>
  m.kind === 'column' && Math.abs(m.box.min.y - BUILDING.foundationThickness) < 1e-9;

describe('StructureGraph', () => {
  const { frags, graph, memberOf } = fracturedBuilding();

  it('has one undirected edge per neighbor pair', () => {
    const pairs = frags.reduce((s, f) => s + f.neighbors.length, 0);
    expect(graph.edgeCount * 2).toBe(pairs);
  });

  it('supports every fragment of the intact building from the anchors', () => {
    expect(graph.solveSupport()).toBe(frags.length);
    expect(graph.findIslands()).toEqual([]);
  });

  it('routes the whole supported mass into the anchors', () => {
    graph.solveSupport();
    graph.computeLoads();
    let intoAnchors = 0;
    for (let e = 0; e < graph.edgeCount; e++) {
      const a = graph.edgeA[e]!;
      const b = graph.edgeB[e]!;
      if (graph.anchor[a] !== graph.anchor[b]) intoAnchors += graph.load[e]!;
    }
    let carried = 0;
    for (let i = 0; i < graph.nodeCount; i++) if (!graph.anchor[i]) carried += graph.mass[i]!;
    expect(intoAnchors / carried).toBeCloseTo(1, 4);
  });

  it('is calibrated so the intact building carries its own weight', () => {
    graph.solveSupport();
    graph.computeLoads();
    for (let e = 0; e < graph.edgeCount; e++) {
      expect(graph.demand[e]!).toBeLessThanOrEqual(graph.capacity[e]! + 1e-3);
    }
  });

  it('cladding never supports structural members', () => {
    graph.solveSupport();
    for (let e = 0; e < graph.edgeCount; e++) {
      const a = graph.edgeA[e]!;
      const b = graph.edgeB[e]!;
      // 외장재 → 구조재 방향으로는 지지가 이어지지 않는다
      if (graph.cladding[a] && !graph.cladding[b]) expect(graph.canSupport(a, b)).toBe(false);
    }
    expect(CLADDING.includes(memberOf(0).kind)).toBe(false); // 0번은 기초
  });
});

describe('CollapseSolver', () => {
  it('intact building: no islands, nothing overloaded, nothing breaks over time', () => {
    const { graph } = fracturedBuilding();
    const solver = new CollapseSolver(graph);
    for (let i = 0; i < 120; i++) {
      const ev = solver.update(1 / 60);
      expect(ev.islands).toEqual([]);
      expect(ev.crushed).toEqual([]);
    }
    expect(solver.overloadedCount).toBe(0);
  });

  it('removing every ground-floor column turns the whole upper structure into an island', () => {
    const { frags, graph, memberOf } = fracturedBuilding();
    frags.forEach((_, i) => {
      if (isGroundColumn(memberOf(i))) graph.detach(i);
    });
    const solver = new CollapseSolver(graph);
    const { islands, crushed } = solver.update(1 / 60);

    // 1층 기둥보다 위에 있는 구조재(보·슬래브·위층 기둥)는 전부 하나의 섬에 들어 있다
    const upper = frags
      .map((_, i) => i)
      .filter((i) => {
        const m = memberOf(i);
        return !CLADDING.includes(m.kind) && !m.anchor && !isGroundColumn(m);
      });
    const largest = islands.reduce((a, b) => (b.length > a.length ? b : a), []);
    const inLargest = new Set(largest);
    expect(upper.length).toBeGreaterThan(0);
    for (const i of upper) expect(inLargest.has(i)).toBe(true);
    for (const i of upper) expect(graph.attached[i]).toBe(0);

    // 1층 외벽 패널은 기초가 받치므로 남고, 위층 슬래브에 닿아 있던 윗부분만 깔려 떨어진다
    expect(crushed.length).toBeGreaterThan(0);
    for (const i of crushed) expect(CLADDING.includes(memberOf(i).kind)).toBe(true);
  });

  it('a single removed column does not drop the building immediately', () => {
    const { frags, graph, memberOf, members } = fracturedBuilding();
    const corner = members.findIndex(isGroundColumn);
    frags.forEach((f, i) => {
      if (f.member === corner) graph.detach(i);
    });
    const { islands } = new CollapseSolver(graph).update(1 / 60);
    const structuralLost = islands.flat().filter((i) => !CLADDING.includes(memberOf(i).kind));
    expect(structuralLost).toEqual([]);
  });

  it('overloaded edges break gradually, not instantly', () => {
    const { graph } = fracturedBuilding();
    // 모든 엣지를 하중 = 강도 × 3 상태로 만든다 (강도를 비례로 줄여야 하중 분배 비율이 안 바뀐다)
    const solver = new CollapseSolver(graph, 1);
    solver.update(0);
    let target = -1;
    for (let e = 0; e < graph.edgeCount; e++) {
      if (graph.demand[e]! > 0) target = e;
      graph.capacity[e] = graph.demand[e]! > 0 ? graph.demand[e]! / 3 : graph.capacity[e]!;
    }
    solver.markDirty();
    solver.update(0, true); // 과부하 목록 갱신
    expect(graph.alive[target]).toBe(1);
    solver.update(0.4); // 손상 0.8
    expect(graph.alive[target]).toBe(1);
    solver.update(0.2); // 손상 1.2 → 끊김
    expect(graph.alive[target]).toBe(0);
  });
});

describe('CollapseSolver batching', () => {
  it('recomputes at most every solveIntervalSec unless forced', () => {
    const { frags, graph, memberOf } = fracturedBuilding();
    const solver = new CollapseSolver(graph);
    solver.update(0); // 첫 계산
    frags.forEach((_, i) => {
      if (isGroundColumn(memberOf(i))) graph.detach(i);
    });
    solver.markDirty();
    expect(solver.update(1 / 60).islands).toEqual([]); // 아직 간격 안 지남
    let islands: number[][] = [];
    for (let t = 0; t < STRUCTURE.solveIntervalSec; t += 1 / 60) {
      islands = islands.concat(solver.update(1 / 60).islands);
    }
    expect(islands.length).toBeGreaterThan(0);
  });
});
