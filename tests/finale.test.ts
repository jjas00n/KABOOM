// Phase 7-2 완파 피날레: 1회 발동, 피날레 정산은 한 번(추가 지급 없음), 결과 합계 = 지갑 증가분, 웨이브 상한.
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { FINALE, PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability } from '../src/destruction/Durability';
import { Completion } from '../src/economy/Completion';
import { Economy } from '../src/economy/Economy';
import { MATERIAL } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { Finale } from '../src/game/Finale';
import { RunStats } from '../src/game/RunStats';
import { GameState, StateMachine } from '../src/game/StateMachine';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;

describe('Completion', () => {
  it('fires exactly once per building, however the rate moves around the threshold', () => {
    const c = new Completion(0.85);
    c.arm();
    const fired: number[] = [];
    [0.1, 0.5, 0.84, 0.85, 0.9, 0.85, 0.99, 1, 1].forEach((rate, k) => {
      c.update(rate);
      if (c.consume()) fired.push(k);
    });
    expect(fired).toEqual([3]);
    c.update(1);
    expect(c.consume()).toBe(false);
    c.arm(); // 다음 건물
    c.update(0.95);
    expect(c.consume()).toBe(true);
    expect(c.consume()).toBe(false);
  });

  it('keeps the signal pending until it is consumed (e.g. a projectile is still flying)', () => {
    const c = new Completion(0.85);
    c.arm();
    c.update(0.9);
    expect(c.ready).toBe(true);
    c.update(0.95); // 기다리는 동안 다시 와도 한 번
    expect(c.consume()).toBe(true);
    expect(c.consume()).toBe(false);
  });

  it('is not armed before a building exists; force() is a one-shot too', () => {
    const c = new Completion(0.85);
    c.update(1);
    expect(c.consume()).toBe(false);
    c.arm();
    c.force();
    c.force();
    expect(c.consume()).toBe(true);
    c.update(1);
    expect(c.consume()).toBe(false);
  });
});

describe('StateMachine finale states', () => {
  it('enters FINALE only from IMPACT or SPECTATE, then RESULT, then IDLE', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const from of Object.values(GameState)) {
      const fsm = new StateMachine(from);
      const ok = from === GameState.IMPACT || from === GameState.SPECTATE;
      expect(fsm.transition(GameState.FINALE)).toBe(ok);
    }
    const fsm = new StateMachine(GameState.SPECTATE);
    expect(fsm.transition(GameState.FINALE)).toBe(true);
    expect(fsm.transition(GameState.SPECTATE)).toBe(false); // 피날레 도중 되돌아가지 않는다
    expect(fsm.transition(GameState.RESULT)).toBe(true);
    expect(fsm.transition(GameState.IDLE)).toBe(true);
    warn.mockRestore();
  });
});

/** 고정 seed 소형 건물 + 경제 + 통계 (게임과 같은 연결, 화면 없음) */
async function site() {
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
  const economy = new Economy();
  const stats = new RunStats();
  economy.onPayout = (_x, _y, _z, _a, _r, source) => {
    if (source === 'fragments') stats.released(1);
  };
  economy.attach(
    system,
    {
      count: frags.length,
      mass: system.graph.mass,
      kind: (i) => member(i).kind,
      material: (i) => (frags[i]!.material === MATERIAL.glass ? 'glass' : 'concrete'),
      durability: (i) => system.durability.max[i]!,
    },
    21,
  );
  stats.start();
  const run = (sec: number, each?: () => void) => {
    for (let t = 0; t < sec; t += dt) {
      physics.step();
      system.step(dt);
      each?.();
    }
  };
  return { system, physics, economy, stats, frags, run };
}

describe('Finale on a real building', () => {
  it('pays the remaining fragments once, never again, and result totals equal the wallet gain', async () => {
    const s = await site();
    const before = s.economy.wallet.money;
    // 발사 2번 상당 (통계에 남게)
    s.stats.fired('cannon');
    s.system.detonate(new Vector3(0, 5, 6.3), 1.6e6, createRng(1));
    s.run(2);
    s.stats.fired('wizard');
    s.system.detonate(new Vector3(-4, 8, 6.3), 1.6e6, createRng(2));
    s.run(2);
    s.stats.finish();

    const finale = new Finale(s.system, s.physics, s.economy);
    const reward = finale.begin();
    expect(reward.finale).toBeGreaterThan(0);
    expect(reward.bonus).toBeCloseTo(
      s.economy.ledger!.totalValue * s.economy.modifiers.total * FINALE.completionBonusFraction,
    );
    expect(s.economy.ledger!.unpaid()).toEqual([]);

    const afterSettle = s.economy.wallet.money;
    let steps = 0;
    while (!finale.collapsed && steps < 2000) {
      finale.stepCollapse(dt);
      s.physics.step();
      s.system.step(dt);
      steps++;
    }
    s.run(3);
    // 피날레 중 추가 지급 없음 (물리로 떨어진 조각이 다시 release돼도 0)
    expect(s.economy.wallet.money).toBe(afterSettle);

    const w = s.economy.wallet;
    expect(w.building.fragments + w.building.finale + w.building.bonus).toBeCloseTo(
      w.money - before,
      6,
    );
    expect(w.buildingTotal).toBeCloseTo(w.money - before, 6);
    expect(w.building.finale).toBeCloseTo(reward.finale, 6);
    expect(w.building.bonus).toBeCloseTo(reward.bonus, 6);
    expect(s.stats.totalShots).toBe(2);
    expect(s.stats.maxChain).toBeGreaterThan(0);
  });

  it('collapses top-down within the per-step cap and leaves only the foundation standing', async () => {
    const s = await site();
    const finale = new Finale(s.system, s.physics, s.economy);
    finale.begin();
    let maxDynamic = 0;
    while (!finale.collapsed) {
      finale.stepCollapse(dt);
      s.physics.step();
      s.system.step(dt);
      maxDynamic = Math.max(maxDynamic, s.physics.movingCount);
    }
    expect(finale.counts.maxPerStep).toBeLessThanOrEqual(FINALE.maxDetachPerStep);
    expect(finale.counts.physical).toBeLessThanOrEqual(FINALE.maxPhysics);
    expect(finale.counts.particles).toBeGreaterThan(0);
    expect(maxDynamic).toBeLessThanOrEqual(FINALE.maxDynamicTotal);
    const g = s.system.graph;
    for (let i = 0; i < g.nodeCount; i++) if (!g.anchor[i]) expect(g.attached[i]).toBe(0);
  });

  it('skip (finishNow) clears everything at once', async () => {
    const s = await site();
    const finale = new Finale(s.system, s.physics, s.economy);
    finale.begin();
    finale.stepCollapse(dt);
    finale.finishNow();
    expect(finale.collapsed).toBe(true);
    const g = s.system.graph;
    for (let i = 0; i < g.nodeCount; i++) if (!g.anchor[i]) expect(g.attached[i]).toBe(0);
  });
});

describe('RunStats', () => {
  it('tracks shots per launcher and the biggest chain between shots', () => {
    const r = new RunStats();
    r.start();
    r.released(5); // 발사 전 분리는 연쇄로 안 센다
    r.fired('cannon');
    r.released(10);
    r.released(4);
    r.fired('wizard');
    r.released(7);
    r.update(2.5);
    r.finish();
    r.update(10); // 피날레 뒤 시간은 안 센다
    r.released(100); // 피날레 뒤 분리도 안 센다 (finish 이후 연쇄 마감)
    expect(r.shots).toEqual({ cannon: 1, wizard: 1 });
    expect(r.maxChain).toBe(14);
    expect(r.elapsed).toBe(2.5);
  });
});
