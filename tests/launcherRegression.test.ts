// 대포 회귀: 발사대 일반화(Launcher) 리팩터링 전에 잰 값과 같아야 한다.
// 같은 seed 건물 + 같은 조준값으로 쏴서 발사 속도·포탄 질량·떨어져 나간 조각 수를 비교한다.
// (Game의 발사 → 충돌 → 관통 폭발 순서를 그대로 따라 한다)
import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { PHYSICS, STRUCTURE } from '../src/config';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability } from '../src/destruction/Durability';
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

/** 리팩터링 전(Phase 6, 3213db6 기준 대포 경로)에서 잰 값 */
const BASELINE = {
  speed: 96,
  mass: 500,
  muzzle: [-0.183206, 5.113441, 57.422282],
  detached: 23, // 내구도(6++) 도입 전 32 (구조재가 한 발에 버틴다: 의도된 변화)
};

async function fireCannon(yaw: number, pitch: number, power: number) {
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
    (i) => ({
      anchor: member(i).anchor,
      cladding: CLADDING.includes(member(i).kind),
    }),
    0,
    false,
    // 게임과 같은 내구도 (건물 seed 21)
    Durability.initial(
      frags.length,
      (i) => member(i).kind,
      (i) => member(i).anchor,
      21,
    ),
  );
  system.ground = ground;
  const spin = createRng(5);

  const shot = cannonShot(yaw, pitch, power, new Vector3(0, 0, 0));
  const projectile = new Projectile(new Scene(), physics);
  projectile.launch(shot.origin, shot.velocity);

  let hit: ReturnType<Projectile['impact']> = null;
  let hitBuilding = false;
  system.onCollisionStarted = (a, b) => {
    if (hit || (!projectile.isBody(a) && !projectile.isBody(b))) return;
    const other = projectile.isBody(a) ? b : a;
    hitBuilding = system.fragments.chunkOfBody(other) !== undefined;
    hit = projectile.impact();
  };
  for (let i = 0; i < 600 && !hit; i++) {
    physics.step();
    system.step(dt);
  }
  expect(hit).not.toBeNull();
  const h = hit!;
  projectile.remove();
  const blasts = hitBuilding
    ? penetrationBlasts(h.point, h.direction, h.energy, h.speed)
    : [{ point: h.point, energy: h.energy, delay: 0 }];
  let t = 0;
  let next = 0;
  for (let i = 0; i < 120; i++) {
    while (next < blasts.length && blasts[next]!.delay <= t) {
      const b = blasts[next++]!;
      system.detonate(new Vector3(b.point.x, b.point.y, b.point.z), b.energy, spin);
    }
    physics.step();
    system.step(dt);
    t += dt;
  }
  let detached = 0;
  for (let i = 0; i < system.graph.nodeCount; i++) if (!system.graph.attached[i]) detached++;
  return {
    speed: shot.velocity.length(),
    mass: projectile.spec.mass,
    muzzle: shot.origin,
    detached,
  };
}

describe('cannon regression (Launcher refactor)', () => {
  it('same seed + same aim → same speed, mass and destroyed fragment count', async () => {
    const r = await fireCannon(0.04, 0.09, 0.7);
    expect(r.speed).toBeCloseTo(BASELINE.speed, 6);
    expect(r.mass).toBe(BASELINE.mass);
    expect(r.muzzle.toArray().map((v) => +v.toFixed(6))).toEqual(BASELINE.muzzle);
    expect(r.detached).toBe(BASELINE.detached);
  });
});
