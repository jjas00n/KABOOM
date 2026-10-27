import RAPIER from '@dimforge/rapier3d-compat';
import { Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { allocateSeeds, memberSeeds } from '../src/building/seedBudget';
import { StructureGraph } from '../src/building/StructureGraph';
import { FIRE, FIREBALL, PHYSICS, STRUCTURE, WIZARD } from '../src/config';
import { CollapseSolver } from '../src/destruction/CollapseSolver';
import { DestructionSystem } from '../src/destruction/DestructionSystem';
import { FireSystem } from '../src/destruction/FireSystem';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { createFragmentMaterials } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';
import { simulateTrajectory, trajectoryCapacity } from '../src/game/ballistics';
import { cannonShot } from '../src/game/Cannon';
import { Projectile } from '../src/game/Projectile';
import { FIREBALL_SPEC, fireballProfile } from '../src/game/fireball';
import { wizardBaseYaw, wizardPivot, wizardShot } from '../src/game/Wizard';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';

const CLADDING: readonly string[] = STRUCTURE.cladding;
const dt = PHYSICS.fixedTimestep;

/**
 * 손으로 만든 작은 그래프: 노드 위치·연결(면적)만. 부피 0.1m³ 콘크리트 블록들.
 * anchors: 지면 고정 노드
 */
function graphOf(
  points: [number, number, number][],
  links: [number, number, number][],
  anchors: number[] = [],
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
  const positions = new Float64Array(points.flat());
  return { graph, positions };
}

function fireOn(
  g: ReturnType<typeof graphOf>,
  fuel: number[],
  settings: ConstructorParameters<typeof FireSystem>[4] = {},
) {
  return new FireSystem(
    g.graph,
    g.positions,
    Float32Array.from(fuel),
    new Uint8Array(g.graph.nodeCount),
    settings,
  );
}

describe('FireSystem', () => {
  it('spreads upward much faster than downward', () => {
    // 아래(0) — 가운데(1) — 위(2), 가운데에 불
    const g = graphOf(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
      ],
      [
        [0, 1, FIRE.areaRef],
        [1, 2, FIRE.areaRef],
      ],
    );
    const fire = fireOn(g, [0, 100, 0]); // 위·아래는 연료가 없어 열만 받는다
    fire.addHeat({ x: 0, y: 1, z: 0 }, 0.1, 1);
    for (let t = 0; t < 1; t += 0.1) fire.update(0.1);
    expect(fire.burning[1]).toBe(1);
    expect(fire.heat[2]!).toBeGreaterThan(fire.heat[0]! * 4);
    expect(fire.heat[2]!).toBeGreaterThan(0.3);
  });

  it('spreads sideways at the side rate and slowly onto slabs', () => {
    const g = graphOf(
      [
        [0, 0, 0],
        [1, 0, 0],
        [-1, 0, 0],
      ],
      [
        [0, 1, FIRE.areaRef],
        [0, 2, FIRE.areaRef],
      ],
    );
    const slab = new Uint8Array([0, 0, 1]);
    const fire = new FireSystem(g.graph, g.positions, Float32Array.from([100, 0, 0]), slab, {
      heatDecay: 0,
    });
    fire.addHeat({ x: 0, y: 0, z: 0 }, 0.1, 1);
    for (let t = 0; t < 1; t += 0.1) fire.update(0.1);
    expect(fire.heat[2]! / fire.heat[1]!).toBeCloseTo(FIRE.slabFactor, 1);
  });

  it('burns out when the fuel is gone and stays charred', () => {
    const g = graphOf([[0, 0, 0]], []);
    const fire = fireOn(g, [2]);
    fire.addHeat({ x: 0, y: 0, z: 0 }, 1, 1);
    fire.update(FIRE.tickSec);
    expect(fire.burningCount).toBe(1);
    for (let t = 0; t < 3; t += 0.1) fire.update(0.1);
    expect(fire.burningCount).toBe(0);
    expect(fire.burning[0]).toBe(0);
    expect(fire.fuel[0]).toBe(0);
    expect(fire.charred[0]!).toBeGreaterThan(0);
    // 다시 데워도 연료가 없으면 안 붙는다
    fire.addHeat({ x: 0, y: 0, z: 0 }, 1, 1);
    fire.update(1);
    expect(fire.burningCount).toBe(0);
  });

  it('never burns more than maxBurning at once; waiting nodes ignite later', () => {
    const points: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) points.push([i * 10, 0, 0]); // 서로 멀리, 연결 없음
    const g = graphOf(points, []);
    const fuel = [1, 1, 1, 50, 50, 50, 50, 50, 50, 50];
    const fire = fireOn(g, fuel, { maxBurning: 3, heatDecay: 0 });
    fire.addHeat({ x: 45, y: 0, z: 0 }, 1000, 1);
    let peak = 0;
    let ever = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 5; t += 0.1) {
      fire.update(0.1);
      peak = Math.max(peak, fire.burningCount);
      for (const i of fire.burningNodes) seen.add(i);
      ever = seen.size;
    }
    expect(peak).toBe(3);
    expect(ever).toBeGreaterThan(3); // 먼저 탄 조각이 꺼지자 대기하던 조각이 붙었다
  });

  it('a long fire weakens the joint until the solver breaks it (delayed collapse)', () => {
    // 지면(0) 위에 무거운 블록(1): 연결이 하나뿐
    const g = graphOf(
      [
        [0, 0, 0],
        [0, 1, 0],
      ],
      [[0, 1, 0.01]],
      [0],
    );
    const solver = new CollapseSolver(g.graph);
    solver.update(0, true);
    const fire = fireOn(g, [0, 1000]);
    fire.addHeat({ x: 0, y: 1, z: 0 }, 0.1, 1);
    const islands: number[][] = [];
    let collapsedAt = -1;
    for (let t = 0; t < 30 && collapsedAt < 0; t += dt) {
      const r = fire.update(dt);
      if (r.weakened) solver.capacityChanged();
      const ev = solver.update(dt);
      islands.push(...ev.islands);
      if (ev.islands.length) collapsedAt = t;
    }
    // 바로 무너지지 않고, 몇 초 타다가 무너진다
    expect(collapsedAt).toBeGreaterThan(2);
    expect(collapsedAt).toBeLessThan(20);
    expect(islands.flat()).toContain(1);
  });

  it('extinguishAll stops every fire', () => {
    const g = graphOf(
      [
        [0, 0, 0],
        [0, 1, 0],
      ],
      [[0, 1, FIRE.areaRef]],
    );
    const fire = fireOn(g, [50, 50]);
    fire.addHeat({ x: 0, y: 0.5, z: 0 }, 5, 1);
    fire.update(0.2);
    expect(fire.burningCount).toBe(2);
    fire.extinguishAll();
    fire.update(1);
    expect(fire.burningCount).toBe(0);
  });

  it('gives window-surround panels more fuel than plain panels and none to glass', () => {
    const g = graphOf(
      [
        [0, 0, 0],
        [1, 0, 0],
        [5, 0, 0],
      ],
      [[0, 1, 0.1]],
    );
    const kinds = ['wallPanel', 'glass', 'wallPanel'];
    const fuel = FireSystem.fuelFor(
      g.graph,
      (i) => kinds[i]!,
      () => 0.5,
    );
    expect(fuel[0]).toBeCloseTo(FIRE.fuel.window!);
    expect(fuel[1]).toBe(0);
    expect(fuel[2]).toBeCloseTo(FIRE.fuel.wallPanel!);
  });
});

/** 고정 seed 소형 건물 + 파괴 시스템 */
async function smallBuilding() {
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
  physics.add(
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
  );
  return { building, frags, system, member };
}

describe('fire explosion', () => {
  it('shatters every standing pane in range but breaks far less concrete than the cannon', async () => {
    const center = new Vector3(0, 5, 6.3); // +z 외벽 2층 앞
    const detachedConcrete = (s: Awaited<ReturnType<typeof smallBuilding>>) =>
      s.frags.filter((f, i) => f.material === MATERIAL.concrete && !s.system.graph.attached[i])
        .length;

    const fire = await smallBuilding();
    fire.system.detonate(center, 0, createRng(1), fireballProfile());
    const glassInRange = fire.frags
      .map((f, i) => ({ f, i }))
      .filter(
        ({ f }) =>
          f.material === MATERIAL.glass &&
          new Vector3(f.centroid.x, f.centroid.y, f.centroid.z).distanceTo(center) <=
            FIREBALL.glassShatterRadius,
      );
    expect(glassInRange.length).toBeGreaterThan(0);
    for (const { i } of glassInRange) expect(fire.system.graph.attached[i]).toBe(0);

    const cannon = await smallBuilding();
    const shot = cannonShot(0, 0.05, 0.7, { x: 0, y: 0, z: 0 });
    const energy = 0.5 * 500 * shot.velocity.lengthSq();
    cannon.system.detonate(center, energy, createRng(1));
    expect(detachedConcrete(fire) * 4).toBeLessThan(detachedConcrete(cannon));
  });
});

describe('wizard', () => {
  it('stands opposite the cannon and fires from the staff tip along the aim', () => {
    const center = { x: 0, y: 8, z: 0 };
    expect(WIZARD.position.z).toBeLessThan(0);
    expect(wizardBaseYaw(center)).toBeCloseTo(0); // -z에서 +z(건물)을 본다
    const pivot = wizardPivot(center, new Vector3());
    const shot = wizardShot(0, 0, 0.5, center);
    const dir = shot.velocity.clone().normalize();
    expect(dir.z).toBeCloseTo(1);
    expect(shot.origin.clone().sub(pivot).normalize().dot(dir)).toBeCloseTo(1);
    expect(shot.origin.distanceTo(pivot)).toBeGreaterThan(WIZARD.staffLength); // 지팡이 끝 너머
    // 각도 제한
    const wild = wizardShot(10, 10, 1, center).velocity.normalize();
    expect(Math.asin(wild.y)).toBeCloseTo(WIZARD.pitchMax);
    expect(wizardShot(0, 0, 1, center).velocity.length()).toBeCloseTo(FIREBALL.speedMax);
  });

  it('fireball flight matches the gravity-scaled trajectory prediction', async () => {
    const physics = await PhysicsWorld.create();
    const projectile = new Projectile(new Scene(), physics, FIREBALL_SPEC);
    const origin = new Vector3(0, 6, -60);
    const velocity = new Vector3(1, 3, 35);
    projectile.launch(origin, velocity);
    const out = new Float32Array(trajectoryCapacity(dt, 2) * 3);
    const g = PHYSICS.gravity.y * FIREBALL.gravityScale;
    const n = simulateTrajectory(origin, velocity, dt, 2, out, -1000, dt, g);
    for (let i = 1; i < n; i++) {
      physics.step();
      physics.sync(1); // 보간 없이 이번 스텝 위치로
      const p = projectile.position;
      projectile.step(dt);
      expect(
        Math.hypot(p.x - out[i * 3]!, p.y - out[i * 3 + 1]!, p.z - out[i * 3 + 2]!),
      ).toBeLessThan(1e-3);
    }
    // 대포탄보다 훨씬 덜 떨어진다: 2초 뒤 낙하 ≈ g·scale·t²/2
    expect(origin.y + velocity.y * 2 - out[(n - 1) * 3 + 1]!).toBeLessThan(4);
  });
});
