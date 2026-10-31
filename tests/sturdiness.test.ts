// 튼튼함 고정: 연쇄 붕괴·느슨한 조각 낙하가 다시 과해지면 실패한다 (6층 Medium, seed 1).
//   A) 대포 10발 (정면 여러 지점) → 파괴율
//   B) 파이어볼 화염 폭발 1번 + 화재 30초 → 파괴율
// 파괴율은 경제와 같은 기준 (기초 제외 질량 중 분리된 비율).
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../src/building/seedBudget';
import { FIREBALL, PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { FireSystem } from '../src/destruction/FireSystem';
import { Economy } from '../src/economy/Economy';
import { MATERIAL } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { cannonShot } from '../src/game/Cannon';
import { fireballProfile } from '../src/game/fireball';
import { penetrationBlasts } from '../src/game/penetration';
import { Projectile } from '../src/game/Projectile';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;
/** 측정값 출력 (튜닝할 때 --silent=false로 본다) */
const LOG = false;

async function site() {
  const building = generateBuilding(DEFAULT_BUILDING);
  const counts = seedCountsForPreset(building.members, 'medium');
  const rng = createRng(1);
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
  economy.attach(
    system,
    {
      count: frags.length,
      mass: system.graph.mass,
      kind: (i) => member(i).kind,
      material: (i) => (frags[i]!.material === MATERIAL.glass ? 'glass' : 'concrete'),
    },
    1,
  );
  // BuildingFire.step과 같은 연결 (파티클·라이트 없이)
  const slab = Uint8Array.from(frags, (_, i) => (member(i).kind === 'slab' ? 1 : 0));
  const fire = new FireSystem(
    system.graph,
    system.positions,
    FireSystem.fuelFor(system.graph, (i) => member(i).kind, createRng(2)),
    slab,
  );
  fire.isSettled = (i) => {
    const chunk = system.fragments.chunkOf[i];
    return !chunk || !chunk.body.rigidBody.isDynamic() || chunk.body.rigidBody.isSleeping();
  };
  const tick = () => {
    physics.step();
    system.step(dt);
    if (fire.update(dt).weakened) system.solver.capacityChanged();
  };
  const run = (sec: number) => {
    for (let t = 0; t < sec; t += dt) tick();
  };
  const projectile = new Projectile(new Scene(), physics);
  let hit: ReturnType<Projectile['impact']> = null;
  let hitBuilding = false;
  system.onCollisionStarted = (a, b) => {
    if (hit || (!projectile.isBody(a) && !projectile.isBody(b))) return;
    const other = projectile.isBody(a) ? b : a;
    hitBuilding = system.fragments.chunkOfBody(other) !== undefined;
    hit = projectile.impact();
  };
  const spin = createRng(5);
  const shoot = (yaw: number, pitch: number, power: number) => {
    const shot = cannonShot(yaw, pitch, power, { x: 0, y: 0, z: 0 });
    hit = null;
    projectile.launch(shot.origin, shot.velocity);
    for (let i = 0; i < 600 && !hit; i++) tick();
    projectile.remove();
    const h = hit as ReturnType<Projectile['impact']>;
    if (!h) return;
    const blasts = hitBuilding
      ? penetrationBlasts(h.point, h.direction, h.energy, h.speed)
      : [{ point: h.point, energy: h.energy, delay: 0 }];
    let t = 0;
    let next = 0;
    for (let i = 0; i < 360; i++) {
      while (next < blasts.length && blasts[next]!.delay <= t) {
        const b = blasts[next++]!;
        system.detonate(new Vector3(b.point.x, b.point.y, b.point.z), b.energy, spin);
      }
      tick();
      t += dt;
    }
  };
  const fireball = (point: Vector3) => {
    system.detonate(point, 0, spin, fireballProfile());
    fire.addHeat(point, FIREBALL.blastHeatRadius, FIREBALL.blastHeat);
  };
  const rate = () => economy.ledger!.destructionRate;
  const stats = () => ({
    rate: +rate().toFixed(3),
    loose: system.stats.looseDrops,
    chain: system.stats.chainBreaks,
    islands: system.stats.islands,
  });
  return { shoot, fireball, run, rate, stats };
}

/** 정면 여러 지점 (yaw, pitch, power) */
const AIMS: [number, number, number][] = [
  [0, 0.08, 0.6],
  [0.06, 0.08, 0.6],
  [-0.06, 0.08, 0.6],
  [0, 0.14, 0.6],
  [0.06, 0.14, 0.6],
  [-0.06, 0.14, 0.6],
  [0.03, 0.04, 0.6],
  [-0.03, 0.04, 0.6],
  [0.03, 0.18, 0.6],
  [-0.03, 0.18, 0.6],
];

describe('sturdiness (chain collapse and loose drops stay moderate)', () => {
  it('ten cannon shots across the facade leave most of the building standing', async () => {
    const s = await site();
    const per: ReturnType<typeof s.stats>[] = [];
    for (const aim of AIMS) {
      s.shoot(...aim);
      per.push(s.stats());
    }
    if (LOG) console.log('cannon x10', JSON.stringify(per));
    const last = per[per.length - 1]!;
    expect(last.rate).toBeGreaterThan(0.02); // 부서지긴 한다
    expect(last.rate).toBeLessThan(STURDY.cannonTenShots);
  }, 120_000);

  it('one fireball with its fire does not bring the whole building loose', async () => {
    const s = await site();
    s.fireball(new Vector3(-1.6, 7.4, 9.8)); // +z 정면 2층
    const per: ReturnType<typeof s.stats>[] = [];
    for (let k = 0; k < 6; k++) {
      s.run(5);
      per.push(s.stats());
    }
    if (LOG) console.log('fireball 30s', JSON.stringify(per));
    expect(per[per.length - 1]!.rate).toBeLessThan(STURDY.fireballThirtySec);
  }, 120_000);

  it('fire still matters: cannon shots into a burnt section break more than into a fresh one', async () => {
    const shots = AIMS.slice(0, 4);
    const fresh = await site();
    for (const aim of shots) fresh.shoot(...aim);
    const burnt = await site();
    burnt.fireball(new Vector3(-1.6, 7.4, 9.8));
    burnt.run(30);
    const before = burnt.rate();
    for (const aim of shots) burnt.shoot(...aim);
    if (LOG) {
      console.log(
        'combo',
        JSON.stringify({ fresh: fresh.stats(), burntBefore: before, burnt: burnt.stats() }),
      );
    }
    expect(burnt.rate() - before).toBeGreaterThan(fresh.rate() * STURDY.fireBoost);
  }, 180_000);
});

/** 튜닝 후 상한 (PERF.md 튜닝 절 측정값보다 여유를 둔다) */
const STURDY = {
  cannonTenShots: 0.35, // 튜닝 후 0.247 (전 0.494)
  fireballThirtySec: 0.1, // 튜닝 후 0.004 (전 0.80)
  fireBoost: 2, // 튜닝 후 불탄 건물 0.62 vs 새 건물 0.18 (3.5배)
};
