// 손상 외관·불변 조건: "보이는 조각은 반드시 맞는다", 손상 자세는 콜라이더와 일치, 손상 부위는 더 깊이 파인다.
import RAPIER from '@dimforge/rapier3d-compat';
import { BufferAttribute, BufferGeometry, Quaternion, Scene, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../src/building/seedBudget';
import { StructureGraph } from '../src/building/StructureGraph';
import { DAMAGE_VISUAL, PENETRATION, PHYSICS, STRUCTURE } from '../src/config';
import { DamageModel } from '../src/destruction/DamageModel';
import { DamageView } from '../src/destruction/DamageView';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { Durability } from '../src/destruction/Durability';
import { checkInvariants } from '../src/destruction/Invariants';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { createFragmentMaterials, withRim, RIM_ATTRIBUTE } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { simulateTrajectory, trajectoryCapacity } from '../src/game/ballistics';
import { cannonShot } from '../src/game/Cannon';
import { penetrationBlasts, penetrationDepth } from '../src/game/penetration';
import { Projectile } from '../src/game/Projectile';
import { PROJECTILE_GROUPS } from '../src/physics/collisionGroups';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;
/** 같은 자리를 노리는 조준 (2층 정면, 관통 문턱 바로 아래 파워) */
const AIM: [number, number, number] = [0.03, 0.1, 0.35];
const CENTER = { x: 0, y: 0, z: 0 };

/** 게임과 같은 순서로 쏜다: 발사 → 충돌 → 관통 폭발(손상 저항) → 6초 진행 */
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
  const materials = createFragmentMaterials();
  const system = new DestructionSystem(
    new Scene(),
    physics,
    frags,
    materials,
    (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
    0,
    true,
    Durability.initial(
      frags.length,
      (i) => member(i).kind,
      (i) => member(i).anchor,
      1,
    ),
  );
  system.ground = ground;
  const view = new DamageView(system, physics, materials);
  const projectile = new Projectile(new Scene(), physics);
  let hit: ReturnType<Projectile['impact']> = null;
  let hitBuilding = false;
  system.onCollisionStarted = (a, b) => {
    if (hit || (!projectile.isBody(a) && !projectile.isBody(b))) return;
    const other = projectile.isBody(a) ? b : a;
    hitBuilding = system.fragments.chunkOfBody(other) !== undefined;
    hit = projectile.impact();
  };
  let maxDropsPerStep = 0;
  const tick = () => {
    const before = system.stats.looseDrops;
    physics.step();
    system.step(dt);
    view.update();
    maxDropsPerStep = Math.max(maxDropsPerStep, system.stats.looseDrops - before);
  };
  const spin = createRng(5);

  /** 한 발 쏘고 6초 진행. 반환: 첫 충돌 지점 */
  const shoot = () => {
    const shot = cannonShot(...AIM, CENTER);
    hit = null;
    projectile.launch(shot.origin, shot.velocity);
    for (let i = 0; i < 600 && !hit; i++) tick();
    const h = hit!;
    projectile.remove();
    const r = DAMAGE_VISUAL.penetrationSampleRadius;
    const deeper = h.point.clone().addScaledVector(h.direction, r);
    const resistance =
      1 -
      DAMAGE_VISUAL.penetrationDamageFactor *
        ((system.damageNear(h.point, r) + system.damageNear(deeper, r)) / 2);
    const blasts = hitBuilding
      ? penetrationBlasts(h.point, h.direction, h.energy, h.speed, 0, resistance)
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
    for (let i = 0; i < 20; i++) view.update(); // 남은 손상 자세 반영
    physics.sync(1);
    return h.point.clone();
  };

  /** 다음 발사 경로를 따라 처음 맞는 콜라이더 (filter 없으면 전부) */
  const firstOnPath = (filter?: number) => {
    const shot = cannonShot(...AIM, CENTER);
    const out = new Float32Array(trajectoryCapacity(dt, 4) * 3);
    const n = simulateTrajectory(shot.origin, shot.velocity, dt, 4, out, 0);
    for (let i = 0; i + 1 < n; i++) {
      const o = new Vector3(out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!);
      const d = new Vector3(out[i * 3 + 3]!, out[i * 3 + 4]!, out[i * 3 + 5]!).sub(o);
      const len = d.length();
      const h = physics.world.castRay(
        new RAPIER.Ray(o, d.divideScalar(len)),
        len,
        true,
        undefined,
        filter,
      );
      if (h) return physics.getByCollider(h.collider.handle) ?? null;
    }
    return null;
  };

  /** 조준선(2층 정면 칸) 주변 떨어져 나간 조각 중 가장 깊은 z */
  const holeDepth = () => {
    let minZ = Infinity;
    for (let i = 0; i < frags.length; i++) {
      if (system.graph.attached[i]) continue;
      const c = frags[i]!.centroid;
      if (Math.hypot(c.x + 1.65, c.y - 7.4) < 1.2) minZ = Math.min(minZ, c.z);
    }
    return minZ;
  };
  return { system, view, physics, shoot, firstOnPath, holeDepth, maxDrops: () => maxDropsPerStep };
}

describe('pass-through fix and invariants (6층 Medium, 같은 자리 연속 사격)', () => {
  let s: Awaited<ReturnType<typeof site>>;
  const depth: number[] = [];
  beforeAll(async () => {
    s = await site();
    for (let k = 0; k < 3; k++) {
      s.shoot();
      depth.push(s.holeDepth());
    }
  });

  it('what the next shot would hit first is what is visibly there (no pass-through)', () => {
    const any = s.firstOnPath();
    const projectile = s.firstOnPath(PROJECTILE_GROUPS);
    expect(any).not.toBeNull();
    // 경로에서 처음 보이는 것이 움직이는 잔해가 아니면, 발사체도 같은 것에 맞는다
    if (any!.rigidBody.isFixed()) expect(projectile).toBe(any);
  });

  it('holds all invariants: colliders, hittable when fixed, no stranded, render = collider', () => {
    const r = checkInvariants(s.system);
    expect(r.noCollider).toEqual([]);
    expect(r.unhittable).toEqual([]);
    expect(r.stranded).toEqual([]);
    expect(r.misaligned).toEqual([]);
    expect(r.maxRenderError).toBeLessThanOrEqual(DAMAGE_VISUAL.maxRenderError);
  });

  it('damaged standing fragments are visibly displaced (physics and render together)', () => {
    let maxOffset = 0;
    const o = s.view.offsets;
    for (let i = 0; i < s.system.graph.nodeCount; i++) {
      if (!s.system.graph.attached[i]) continue;
      maxOffset = Math.max(maxOffset, Math.hypot(o[i * 3]!, o[i * 3 + 1]!, o[i * 3 + 2]!));
    }
    expect(maxOffset).toBeGreaterThan(0.01);
    expect(maxOffset).toBeLessThanOrEqual(
      Math.hypot(DAMAGE_VISUAL.gapMax, DAMAGE_VISUAL.gapMax + DAMAGE_VISUAL.sagMax) + 1e-6,
    );
  });

  it('shooting the damaged spot again digs deeper', () => {
    // 내구도: 둘째 발은 구조재 내구도를 깎고, 셋째 발이 뚫고 들어간다 (전엔 둘째 발에 바로)
    expect(depth[2]!).toBeLessThan(depth[0]! - 2);
  });

  it('weak fragments drop on their own, never more than the per-step cap', () => {
    expect(s.system.stats.looseDrops).toBeGreaterThan(0);
    expect(s.maxDrops()).toBeGreaterThan(0);
    expect(s.maxDrops()).toBeLessThanOrEqual(DAMAGE_VISUAL.maxLooseDropsPerStep);
  });
});

/** 손으로 만든 작은 그래프 (fire.test.ts와 같은 방식) */
function graphOf(
  points: [number, number, number][],
  links: [number, number, number][],
  anchors: number[],
) {
  const frags = points.map(
    ([x, y, z], i) =>
      ({
        centroid: { x, y, z },
        volume: 0.1,
        material: MATERIAL.concrete,
        member: i,
        neighbors: links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : [])),
        neighborAreas: links.flatMap(([a, b, area]) => (a === i || b === i ? [area] : [])),
      }) as unknown as Fragment,
  );
  const graph = StructureGraph.fromFragments(frags, (i) => ({
    anchor: anchors.includes(i),
    cladding: false,
  }));
  return { graph, positions: new Float64Array(points.flat()) };
}

describe('DamageModel', () => {
  // 가운데(1)에 이웃 4개: 아래(0, 앵커), 위(2), 왼쪽(3), 오른쪽(4)
  const make = () =>
    graphOf(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
        [-1, 1, 0],
        [1, 1, 0],
      ],
      [
        [0, 1, 0.2],
        [1, 2, 0.2],
        [1, 3, 0.2],
        [1, 4, 0.2],
      ],
      [0],
    );

  it('damage grows as more of a fragment’s joints break', () => {
    const { graph, positions } = make();
    const model = new DamageModel(graph, positions);
    const changed: number[] = [];
    model.update(changed);
    expect(model.damage[1]).toBe(0);
    const seen = [0];
    for (const e of [2, 3, 1]) {
      graph.breakEdge(e);
      model.update(changed);
      expect(model.damage[1]!).toBeGreaterThan(seen[seen.length - 1]!);
      seen.push(model.damage[1]!);
    }
  });

  it('gaps open away from broken neighbors, sags when support below is lost, never lifts', () => {
    const { graph, positions } = make();
    const model = new DamageModel(graph, positions);
    const off = new Vector3();
    const rot = new Quaternion();
    graph.breakEdge(3); // 오른쪽(4)과 끊김
    model.update([]);
    model.pose(1, false, off, rot);
    expect(off.x).toBeLessThan(0); // 오른쪽 이웃에게서 멀어진다 (왼쪽으로)
    expect(off.y).toBeLessThanOrEqual(0);
    graph.breakEdge(0); // 아래 지지(0)와 끊김
    model.update([]);
    model.pose(1, false, off, rot);
    expect(off.y).toBeLessThan(0); // 처진다
  });

  it('marks a fragment loose when its remaining joints cannot hold its weight', () => {
    const { graph, positions } = make();
    const model = new DamageModel(graph, positions, null, { looseFactor: 1e9 });
    model.update([]);
    expect(model.isLoose(1)).toBe(false); // 멀쩡하면(damage 0) 느슨하지 않다
    graph.breakEdge(0);
    model.update([]);
    expect(model.isLoose(1)).toBe(true);
    expect(model.isLoose(0)).toBe(false); // 앵커는 안 떨어진다
  });
});

describe('penetration through damaged concrete', () => {
  it('lower resistance lowers the threshold and goes deeper; resistance 1 is unchanged', () => {
    const e = PENETRATION.minEnergy * 0.9; // 멀쩡하면 못 뚫는 에너지
    expect(penetrationDepth(e)).toBe(0);
    expect(penetrationDepth(e, 0.3)).toBeGreaterThan(2);
    expect(penetrationDepth(3e6, 1)).toBe(penetrationDepth(3e6));
    const p = { x: 0, y: 5, z: 0 };
    const d = { x: 0, y: 0, z: -1 };
    expect(penetrationBlasts(p, d, e, 70, 0, 0.3).length).toBeGreaterThan(1);
  });
});

describe('crack rim geometry', () => {
  it('fans each exterior polygon from a center vertex: boundary rim 1, center 0', () => {
    // 사각형 하나 (v0 기준 팬 2개)
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    );
    g.setAttribute('uv', new BufferAttribute(new Float32Array(8), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const out = withRim(g);
    const rim = out.getAttribute(RIM_ATTRIBUTE);
    expect(rim.count).toBe(5);
    expect(Array.from(rim.array as Float32Array)).toEqual([1, 1, 1, 1, 0]);
    const pos = out.getAttribute('position');
    expect([pos.getX(4), pos.getY(4)]).toEqual([0.5, 0.5]);
    expect(out.getIndex()!.count).toBe(12); // 삼각형 4개
  });
});
