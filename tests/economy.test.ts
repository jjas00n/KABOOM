import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { ECONOMY, PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { BuildingLedger, type LedgerNodes } from '../src/economy/BuildingLedger';
import { Economy } from '../src/economy/Economy';
import { fragmentValue, rollRare, unitPrice } from '../src/economy/FragmentValue';
import { Modifiers } from '../src/economy/Modifiers';
import { MATERIAL } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { cannonShot } from '../src/game/Cannon';
import { penetrationBlasts } from '../src/game/penetration';
import { Projectile } from '../src/game/Projectile';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;

describe('Modifiers', () => {
  it('composes as (1 + sum of additive) × product of multiplicative, regardless of insertion order', () => {
    const a = new Modifiers()
      .set('order', 2)
      .set('upgradeA', 0.2, 'additive')
      .set('talent', 1.5)
      .set('upgradeB', 0.3, 'additive');
    const b = new Modifiers()
      .set('upgradeB', 0.3, 'additive')
      .set('talent', 1.5)
      .set('upgradeA', 0.2, 'additive')
      .set('order', 2);
    expect(a.total).toBeCloseTo((1 + 0.2 + 0.3) * 2 * 1.5);
    expect(b.total).toBe(a.total);
    // 가산은 곱셈 전에 합쳐진다: (1+0.2+0.3)×3 ≠ 1×1.2×1.3×3
    expect(a.total).not.toBeCloseTo(1.2 * 1.3 * 2 * 1.5);
  });

  it('replaces a modifier set again under the same name (no double application)', () => {
    const m = new Modifiers().set('order', 2).set('order', 3);
    expect(m.total).toBe(3);
    m.set('order', 0.5, 'additive'); // 종류를 바꿔도 하나만 남는다
    expect(m.total).toBe(1.5);
    expect(new Modifiers().total).toBe(1);
  });
});

describe('FragmentValue', () => {
  it('prices by kind first (foundation 0), then material, with a minimum value', () => {
    expect(unitPrice('foundation', 'concrete')).toBe(0);
    expect(unitPrice('wallPanel', 'concrete')).toBe(ECONOMY.pricePerKg.concrete);
    expect(unitPrice('glass', 'glass')).toBe(ECONOMY.pricePerKg.glass);
    expect(fragmentValue(1e6, 'foundation', 'concrete', 1, false)).toBe(0); // 최소 가치도 없음
    expect(fragmentValue(0.001, 'wallPanel', 'concrete', 1, false)).toBe(ECONOMY.minValue);
    const big = fragmentValue(10_000, 'slab', 'concrete', 1, false);
    expect(big).toBeCloseTo(10_000 * ECONOMY.pricePerKg.concrete!);
    expect(fragmentValue(10_000, 'slab', 'concrete', 2, true)).toBeCloseTo(
      big * 2 * ECONOMY.rareMultiplier,
    );
  });

  it('rare fragments are off by default and seed-deterministic when enabled', () => {
    const all = () => true;
    expect(rollRare(5000, 7, all).some((v) => v === 1)).toBe(ECONOMY.rareEnabled);
    const a = rollRare(5000, 7, all, true, 0.01);
    const b = rollRare(5000, 7, all, true, 0.01);
    expect(Array.from(a)).toEqual(Array.from(b));
    const count = a.reduce((s, v) => s + v, 0);
    expect(count).toBeGreaterThan(20);
    expect(count).toBeLessThan(90);
    expect(
      rollRare(5000, 7, (i) => i % 2 === 0, true, 1).every((v, i) => v === (i % 2 === 0 ? 1 : 0)),
    ).toBe(true);
  });
});

/** 조각 n개: 0번은 기초, 나머지 콘크리트 100kg (2·3번은 유리 10kg) */
function nodes(n: number): LedgerNodes {
  return {
    count: n,
    mass: Array.from({ length: n }, (_, i) => (i === 2 || i === 3 ? 10 : 100)),
    kind: (i) => (i === 0 ? 'foundation' : i === 2 || i === 3 ? 'glass' : 'wallPanel'),
    material: (i) => (i === 2 || i === 3 ? 'glass' : 'concrete'),
  };
}

describe('BuildingLedger', () => {
  it('never pays the same fragment twice (re-released debris, overlapping events)', () => {
    const ledger = new BuildingLedger(nodes(10), 1, false);
    const first = ledger.release([1, 2, 3], 1);
    expect(first.count).toBe(3);
    const again = ledger.release([3, 2, 1, 1], 1);
    expect(again.count).toBe(0);
    expect(again.amount).toBe(0);
    const mixed = ledger.release([1, 4, 4, 0], 1); // 0 = 기초: 지급 대상 아님
    expect(mixed.count).toBe(1);
    expect(ledger.paidAmount).toBeCloseTo(first.amount + mixed.amount);
  });

  it('destruction rate rises monotonically from 0 to exactly 1, ignoring the foundation', () => {
    const n = 200;
    const ledger = new BuildingLedger(nodes(n), 1, false);
    expect(ledger.destructionRate).toBe(0);
    const order = Array.from({ length: n }, (_, i) => i);
    const rng = createRng(3);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let prev = 0;
    for (let k = 0; k < n; k += 7) {
      ledger.release(order.slice(k, k + 7), 1);
      expect(ledger.destructionRate).toBeGreaterThanOrEqual(prev);
      prev = ledger.destructionRate;
    }
    expect(ledger.destructionRate).toBe(1);
    expect(ledger.unpaid()).toEqual([]);
  });
});

describe('Economy', () => {
  const source = () => ({
    positions: new Float64Array(30),
    onReleased: null as ((frags: readonly number[]) => void) | null,
  });

  it('pays through the release event, separates finale income, and unsubscribes on detach', () => {
    const eco = new Economy();
    const src = source();
    eco.attach(src, nodes(10), 1);
    src.onReleased!([1, 2]);
    const fragments = eco.wallet.building.fragments;
    expect(fragments).toBeGreaterThan(0);
    eco.releaseFinale(eco.ledger!.unpaid());
    expect(eco.wallet.building.finale).toBeGreaterThan(0);
    expect(eco.wallet.building.fragments).toBe(fragments);
    expect(eco.wallet.buildingTotal).toBeCloseTo(eco.wallet.money);
    eco.detach();
    expect(src.onReleased).toBeNull();
  });

  it('updates the destruction rate only on the CollapseSolver cadence', () => {
    const eco = new Economy();
    const src = source();
    eco.attach(src, nodes(10), 1);
    src.onReleased!([1, 4, 5]);
    eco.update(STRUCTURE.solveIntervalSec / 4);
    expect(eco.destructionRate).toBe(0); // 아직 주기 전
    eco.update(STRUCTURE.solveIntervalSec);
    expect(eco.destructionRate).toBeGreaterThan(0);
  });

  it('applies the composed Modifiers to every payout', () => {
    const eco = new Economy();
    const src = source();
    eco.attach(src, nodes(10), 1);
    src.onReleased!([1]);
    const base = eco.wallet.money;
    eco.modifiers.set('order', 3);
    src.onReleased!([4]); // 1번과 같은 조각 가치
    expect(eco.wallet.money - base).toBeCloseTo(base * 3);
  });
});

/** 고정 seed 소형 건물에 대포 n발 (게임과 같은 순서), 경제가 지급을 받는다 */
async function shootBuilding(shots: number) {
  const building = generateBuilding({ ...DEFAULT_BUILDING, floors: 3, baysX: 2, baysZ: 2 });
  const counts = allocateSeeds(building.members, 700);
  const rng = createRng(21);
  const frags = runFracture({
    jobs: building.members.map((m, i) => ({
      box: m.box,
      seeds: memberSeeds(m, counts[i]!, rng),
      material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
    })),
  });
  const physics = await PhysicsWorld.create();
  const ground = physics.add(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    RAPIER.ColliderDesc.cuboid(100, 0.5, 100),
  );
  const member = (i: number) => building.members[frags[i]!.member]!;
  const system = new DestructionSystem(
    new Scene(),
    physics,
    frags,
    createFragmentMaterials(),
    (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
    0,
    true,
  );
  system.ground = ground;
  const economy = new Economy();
  economy.rareEnabled = true; // 결정성은 희귀 파편까지 포함해서
  economy.attach(
    system,
    {
      count: frags.length,
      mass: system.graph.mass,
      kind: (i) => member(i).kind,
      material: (i) => (frags[i]!.material === MATERIAL.glass ? 'glass' : 'concrete'),
    },
    21,
  );
  const projectile = new Projectile(new Scene(), physics);
  let hit: ReturnType<Projectile['impact']> = null;
  system.onCollisionStarted = (a, b) => {
    if (hit || (!projectile.isBody(a) && !projectile.isBody(b))) return;
    hit = projectile.impact();
  };
  const spin = createRng(5);
  const rates: number[] = [];
  for (let s = 0; s < shots; s++) {
    const shot = cannonShot(0.04 - s * 0.03, 0.09, 0.7, new Vector3());
    hit = null;
    projectile.launch(shot.origin, shot.velocity);
    for (let i = 0; i < 600 && !hit; i++) {
      physics.step();
      system.step(dt);
      economy.update(dt);
    }
    projectile.remove();
    const h = hit as ReturnType<Projectile['impact']>;
    if (!h) continue; // 빗나감
    const blasts = penetrationBlasts(h.point, h.direction, h.energy, h.speed);
    let t = 0;
    let next = 0;
    for (let i = 0; i < 180; i++) {
      while (next < blasts.length && blasts[next]!.delay <= t) {
        const b = blasts[next++]!;
        system.detonate(new Vector3(b.point.x, b.point.y, b.point.z), b.energy, spin);
      }
      physics.step();
      system.step(dt);
      economy.update(dt);
      rates.push(economy.destructionRate);
      t += dt;
    }
  }
  return { system, economy, member, rates };
}

describe('economy on a real building (3 cannon shots)', () => {
  it('pays for exactly the detached mass, never twice, and the rate only goes up', async () => {
    const { system, economy, member, rates } = await shootBuilding(3);
    const ledger = economy.ledger!;
    let detachedMass = 0;
    let detachedCount = 0;
    for (let i = 0; i < system.graph.nodeCount; i++) {
      if (system.graph.attached[i] || member(i).kind === 'foundation') continue;
      detachedMass += system.graph.mass[i]!;
      detachedCount++;
    }
    expect(detachedCount).toBeGreaterThan(50);
    // 질량 합 일치: 지급된 질량 = 구조에서 떨어진 질량
    expect(ledger.paidMass).toBeCloseTo(detachedMass, 3);
    expect(ledger.paid.reduce((s, v) => s + v, 0)).toBe(detachedCount);
    // 지갑 = 장부 지급 합 (중복 지급이면 지갑이 더 커진다)
    expect(economy.wallet.money).toBeCloseTo(ledger.paidAmount, 6);
    for (let k = 1; k < rates.length; k++) expect(rates[k]!).toBeGreaterThanOrEqual(rates[k - 1]!);
    expect(rates[rates.length - 1]!).toBeGreaterThan(0);
  });

  it('same seed + same input → same income (deterministic)', async () => {
    const a = await shootBuilding(2);
    const b = await shootBuilding(2);
    expect(b.economy.wallet.money).toBe(a.economy.wallet.money);
    expect(Array.from(b.economy.ledger!.paid)).toEqual(Array.from(a.economy.ledger!.paid));
    expect(Array.from(b.economy.ledger!.rare)).toEqual(Array.from(a.economy.ledger!.rare));
  });
});
