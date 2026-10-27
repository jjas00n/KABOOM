// 건물 파괴의 지휘자: 구조 그래프·붕괴 판정(순수 로직)과 조각 물리(FragmentSet)·잔해 정책(DebrisManager)을 잇는다.
//
// 흐름
//   detonate  → 반경 안 엣지 끊기, 코어 조각 떼어내기 → 임펄스
//   step      → 충돌 연쇄 판정 → CollapseSolver (섬 → compound 덩어리, 깔린 외장재 → 조각)
//             → 떨어지는 덩어리 충격 감지 → 약한 내부 엣지부터 끊어 분해 → 잔해 정리
import { Vector3, type Scene } from 'three';
import { StructureGraph, type NodeInfo } from '../building/StructureGraph';
import { DEBRIS, STRUCTURE } from '../config';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import type { FragmentMaterials } from '../fracture/FragmentMeshes';
import type { Vec3Like } from '../fracture/polyhedron';
import { DEBRIS_GROUPS } from '../physics/collisionGroups';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import { CollapseSolver, type CollapseEvents } from './CollapseSolver';
import { DebrisManager } from './DebrisManager';
import { applyExplosion, blastRadius, breakInBlast, type BlastShape } from './Explosion';
import { FragmentSet, type Chunk } from './FragmentSet';

export interface DestructionStats {
  islands: number;
  shatters: number;
  chainBreaks: number;
  overloaded: number;
  compounds: number;
  frozen: number;
  fading: number;
}

/** 대포 외의 폭발 모양 (화염 폭발). 안 넘기면 대포와 완전히 같은 경로 */
export interface BlastProfile extends BlastShape {
  /** 에너지 대신 이 반경을 쓴다 (m) */
  radius: number;
  peakDeltaV: number;
  /** 이 반경 안의 서 있는 유리는 전부 떨어져 나간다 (열 충격) */
  glassShatterRadius: number;
}

const velocity = new Vector3();

export class DestructionSystem {
  readonly graph: StructureGraph;
  readonly solver: CollapseSolver;
  readonly fragments: FragmentSet;
  readonly debris: DebrisManager;
  readonly stats: DestructionStats = {
    islands: 0,
    shatters: 0,
    chainBreaks: 0,
    overloaded: 0,
    compounds: 0,
    frozen: 0,
    fading: 0,
  };
  /** 노드 원래 질량중심 xyz (서 있는 노드는 움직이지 않는다) */
  readonly positions: Float64Array;
  /** 움직이는 다조각 덩어리 (충격 감시 대상) */
  private readonly compounds = new Set<Chunk>();
  /** 굳은 잔해 (구조에 속하지 않는 fixed 덩어리). 근처가 무너지면 다시 깨운다. */
  private readonly frozen = new Set<Chunk>();
  private readonly toShatter: { chunk: Chunk; dv: number }[] = [];
  /**
   * 충돌이 시작될 때마다 (연쇄 판정 전에). 충돌 이벤트 큐는 여기서 비우므로
   * 포탄처럼 다른 쪽에서 충돌을 알아야 하면 이 훅을 쓴다.
   */
  onCollisionStarted: ((a: PhysicsBody, b: PhysicsBody) => void) | null = null;
  /** 지면 바디 (있으면 떨어진 조각이 지면에 부딪힐 때 onGroundImpact) */
  ground: PhysicsBody | null = null;
  /** 움직이는 덩어리가 지면에 처음 닿음. speed: 충돌 직전 속력 (m/s) — 먼지 등 이펙트용 */
  onGroundImpact: ((body: PhysicsBody, speed: number) => void) | null = null;
  /** 유리 조각이 처음으로 떨어져 나감 (조각 원래 자리) — 이펙트용 */
  onGlassBroken: ((position: Vec3Like) => void) | null = null;
  private readonly glassBroken: Uint8Array;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
    frags: readonly Fragment[],
    materials: FragmentMaterials,
    nodeInfo: (index: number) => NodeInfo,
    simpleColliderMaxVolume = 0,
  ) {
    this.graph = StructureGraph.fromFragments(frags, nodeInfo);
    this.solver = new CollapseSolver(this.graph);
    this.positions = new Float64Array(frags.length * 3);
    this.glassBroken = new Uint8Array(frags.length);
    frags.forEach((f, i) => this.positions.set([f.centroid.x, f.centroid.y, f.centroid.z], i * 3));
    this.debris = new DebrisManager(physics, {
      onRemove: (body) => this.forget(body),
      onFrozen: (body) => this.onFrozen(body),
    });
    this.fragments = new FragmentSet(scene, physics, frags, materials, {
      simpleColliderMaxVolume,
      onDynamic: (chunk) => this.onDynamic(chunk),
    });
  }

  /**
   * 폭발: 에너지(J)로 반경을 정해 구조를 끊고 조각을 날린다. 섬 판정은 즉시 한 번 돌린다.
   * profile을 넘기면 그 반경·모양·세기로 (화염 폭발).
   * 반환: 파괴 반경
   */
  detonate(
    center: Vec3Like,
    energy: number,
    random?: () => number,
    profile?: BlastProfile,
  ): number {
    const radius = profile ? profile.radius : blastRadius(energy);
    for (const i of breakInBlast(this.graph, this.positions, center, radius, profile)) {
      this.fragments.activate(i);
    }
    if (profile) this.shatterGlass(center, profile.glassShatterRadius);
    this.wakeFrozen(
      (p) => (p.x - center.x) ** 2 + (p.y - center.y) ** 2 + (p.z - center.z) ** 2 <= radius ** 2,
    );
    this.solver.markDirty();
    this.handleCollapse(this.solver.update(0, true));
    applyExplosion(this.fragments.bodies(), center, {
      radius,
      random,
      peakDeltaV: profile?.peakDeltaV,
    });
    this.debris.enforceCap();
    return radius;
  }

  /** 반경 안의 서 있는 유리를 전부 구조에서 떼어낸다 */
  private shatterGlass(center: Vec3Like, radius: number): void {
    const r2 = radius * radius;
    const p = this.positions;
    const frags = this.fragments.fragments;
    for (let i = 0; i < this.graph.nodeCount; i++) {
      if (!this.graph.attached[i] || frags[i]!.material !== MATERIAL.glass) continue;
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 <= r2 && this.graph.detach(i)) this.fragments.activate(i);
    }
  }

  /** 고정 timestep마다 (physics.step 직후) */
  step(dt: number): void {
    this.processCollisions();
    this.handleCollapse(this.solver.update(dt));
    this.checkImpacts();
    this.debris.step(dt);
    this.debris.enforceCap();
    this.stats.overloaded = this.solver.overloadedCount;
    this.stats.compounds = this.compounds.size;
    this.stats.frozen = this.frozen.size;
  }

  /** 렌더 프레임마다 */
  update(dt: number): void {
    this.fragments.updateFades(dt);
    this.stats.fading = this.fragments.fadingCount;
  }

  /** 킬 높이 등 바깥에서 물리 바디가 제거될 때 */
  forget(body: PhysicsBody): void {
    const chunk = this.fragments.chunkOfBody(body);
    if (!chunk) return;
    this.compounds.delete(chunk);
    this.frozen.delete(chunk);
    this.fragments.removeChunk(chunk);
  }

  dispose(): void {
    this.fragments.dispose();
    this.debris.clear();
    this.compounds.clear();
    this.frozen.clear();
  }

  private handleCollapse({ islands, crushed }: CollapseEvents): void {
    for (const island of islands) {
      this.stats.islands++;
      if (island.length === 1) this.fragments.activate(island[0]!);
      else this.fragments.merge(island);
      this.wakeFrozenAround(island);
    }
    for (const i of crushed) this.fragments.activate(i);
  }

  private onDynamic(chunk: Chunk): void {
    // 구조에서 떨어져 나온 조각 = 잔해: 포탄과는 부딪히지 않는다 (굳은 뒤에도 유지)
    for (const c of chunk.body.colliders) c.setCollisionGroups(DEBRIS_GROUPS);
    this.frozen.delete(chunk);
    if (chunk.frags.length > 1) this.compounds.add(chunk);
    this.debris.add(chunk.body, chunk.volume);
    if (this.onGlassBroken) {
      for (const i of chunk.frags) {
        if (this.glassBroken[i] || this.fragments.fragments[i]!.material !== MATERIAL.glass)
          continue;
        this.glassBroken[i] = 1;
        this.onGlassBroken(this.fragments.fragments[i]!.centroid);
      }
    }
  }

  private onFrozen(body: PhysicsBody): void {
    const chunk = this.fragments.chunkOfBody(body);
    if (!chunk) return;
    this.compounds.delete(chunk);
    this.frozen.add(chunk);
    if (chunk.frags.length === 1 && chunk.volume < DEBRIS.fadeVolume) this.fragments.fade(chunk);
  }

  /** 떨어지는 덩어리의 속도가 한 스텝에 크게 바뀌면(부딪힘) 분해 */
  private checkImpacts(): void {
    for (const chunk of this.compounds) {
      if (!chunk.body.alive) {
        this.compounds.delete(chunk);
        continue;
      }
      chunk.body.rigidBody.linvel(velocity);
      const dv = velocity.distanceTo(chunk.lastVelocity);
      chunk.lastVelocity.copy(velocity);
      if (dv > STRUCTURE.impactSpeedChange) this.toShatter.push({ chunk, dv });
    }
    for (const { chunk, dv } of this.toShatter) this.shatter(chunk, dv);
    this.toShatter.length = 0;
  }

  /**
   * 충격 속도 변화 dv로 덩어리 내부 엣지를 끊는다. 강한(응력이 큰) 엣지일수록 버틴다:
   * dv > impactBreakSpeed × √(엣지 응력 / strengthPerArea) 이면 끊김. 남은 연결 덩어리대로 나눈다.
   */
  private shatter(chunk: Chunk, dv: number): void {
    const g = this.graph;
    const inChunk = new Set(chunk.frags);
    for (const i of chunk.frags) {
      for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
        const e = g.incident[k]!;
        if (!g.alive[e] || !inChunk.has(g.other(e, i))) continue;
        const stress = g.capacity[e]! / Math.max(g.area[e]!, 1e-9);
        const threshold =
          STRUCTURE.impactBreakSpeed * Math.sqrt(stress / STRUCTURE.strengthPerArea);
        if (dv > threshold) g.breakEdge(e);
      }
    }
    const comps = g.components(chunk.frags);
    if (comps.length <= 1) return;
    const groups: number[][] = [];
    for (const comp of comps) {
      if (comp.length >= STRUCTURE.minChunkFragments) groups.push(comp);
      else for (const f of comp) groups.push([f]);
    }
    this.compounds.delete(chunk);
    this.fragments.split(chunk, groups);
    this.stats.shatters++;
  }

  /** 움직이는 바디가 서 있는 구조 조각에 세게 부딪히면 그 조각을 떼어낸다 (연쇄 파괴) */
  private processCollisions(): void {
    this.physics.events.drain((e) => {
      if (!e.started) return;
      const a = this.physics.getByCollider(e.collider1);
      const b = this.physics.getByCollider(e.collider2);
      if (!a || !b) return;
      this.onCollisionStarted?.(a, b);
      if (this.ground && (a === this.ground || b === this.ground)) {
        const mover = a === this.ground ? b : a;
        if (this.onGroundImpact && this.fragments.chunkOfBody(mover)) {
          this.onGroundImpact(mover, mover.preStepVelocity.length());
        }
        return;
      }
      if (!this.chainCheck(a, b)) this.chainCheck(b, a);
    });
  }

  private chainCheck(standing: PhysicsBody, mover: PhysicsBody): boolean {
    if (!standing.alive || !mover.alive) return false;
    if (!standing.rigidBody.isFixed() || mover.rigidBody.isFixed()) return false;
    const chunk = this.fragments.chunkOfBody(standing);
    if (!chunk || chunk.frags.length !== 1) return false;
    const i = chunk.frags[0]!;
    const g = this.graph;
    if (!g.attached[i] || g.anchor[i]) return false;
    const speed = mover.preStepVelocity.length(); // 충돌로 멈추기 전 속도
    if (speed < STRUCTURE.chainMinSpeed) return false;
    const energy = 0.5 * mover.rigidBody.mass() * speed * speed;
    if (energy <= STRUCTURE.chainJoulesPerKg * g.supportCapacity(i)) return false;
    g.detach(i);
    this.fragments.activate(i);
    this.solver.markDirty();
    this.stats.chainBreaks++;
    return true;
  }

  /** 떨어지는 섬의 AABB(+여유) 안 굳은 잔해를 깨운다 (받침이 사라져 공중에 뜨지 않게) */
  private wakeFrozenAround(island: readonly number[]): void {
    if (this.frozen.size === 0) return;
    const p = this.positions;
    const m = STRUCTURE.wakeMargin;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const i of island) {
      minX = Math.min(minX, p[i * 3]!);
      minY = Math.min(minY, p[i * 3 + 1]!);
      minZ = Math.min(minZ, p[i * 3 + 2]!);
      maxX = Math.max(maxX, p[i * 3]!);
      maxY = Math.max(maxY, p[i * 3 + 1]!);
      maxZ = Math.max(maxZ, p[i * 3 + 2]!);
    }
    this.wakeFrozen(
      (q) =>
        q.x >= minX - m &&
        q.x <= maxX + m &&
        q.y >= minY - m &&
        q.y <= maxY + m &&
        q.z >= minZ - m &&
        q.z <= maxZ + m,
    );
  }

  private wakeFrozen(inside: (p: Vector3) => boolean): void {
    for (const chunk of [...this.frozen]) {
      if (inside(chunk.body.currPos)) this.fragments.activateChunk(chunk);
    }
  }
}
