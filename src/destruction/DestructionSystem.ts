// 건물 파괴의 지휘자: 구조 그래프·붕괴 판정(순수 로직)과 조각 물리(FragmentSet)·잔해 정책(DebrisManager)을 잇는다.
//
// 흐름
//   detonate  → 반경 안 엣지 끊기, 코어 조각 떼어내기 → 임펄스
//   step      → 충돌 연쇄 판정 → CollapseSolver (섬 → compound 덩어리, 깔린 외장재 → 조각)
//             → 떨어지는 덩어리 충격 감지 → 약한 내부 엣지부터 끊어 분해 → 잔해 정리
//             → (damage 켬) 손상도 갱신 → 너무 약해진 조각을 스텝당 상한까지 떨어뜨린다
// damage를 켜면 이미 손상된 곳은 폭발·잔해 충돌에 더 쉽게 떨어져 나간다 (DamageModel).
// 내구도(Durability): 직접 타격(폭발·충돌 연쇄·착지 분해)에는 버티며 내구도만 깎인다.
//   지지 상실·과부하·느슨 낙하는 내구도를 무시한다 (받침이 없으면 떨어진다).
import { Vector3, type Scene } from 'three';
import { StructureGraph, type NodeInfo } from '../building/StructureGraph';
import { DAMAGE_VISUAL, DEBRIS, DURABILITY, EXPLOSION, STRUCTURE } from '../config';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import type { FragmentMaterials } from '../fracture/FragmentMeshes';
import type { Vec3Like } from '../fracture/polyhedron';
import { DEBRIS_GROUPS, DEFAULT_GROUPS } from '../physics/collisionGroups';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import { CollapseSolver, type CollapseEvents } from './CollapseSolver';
import { DamageModel } from './DamageModel';
import { Durability } from './Durability';
import { DebrisManager } from './DebrisManager';
import { applyExplosion, blastRadius, breakInBlast, type BlastShape } from './Explosion';
import { FragmentSet, type Chunk } from './FragmentSet';

export interface DestructionStats {
  islands: number;
  shatters: number;
  chainBreaks: number;
  /** 내구도로 버틴 타격 수 (누적) */
  durabilityHits: number;
  /** 너무 약해져 떨어뜨린 조각 수 (누적) */
  looseDrops: number;
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
    durabilityHits: 0,
    looseDrops: 0,
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
  /**
   * 조각들이 dynamic으로 전환됨 (구조에서 분리, 굳은 잔해가 다시 깨어난 경우도 포함).
   * 경제(파편 수익)가 구독한다 — 같은 조각이 여러 번 올 수 있으니 받는 쪽이 중복을 거른다.
   */
  onReleased: ((frags: readonly number[]) => void) | null = null;
  private readonly glassBroken: Uint8Array;
  /** 조각 손상도·손상 자세·느슨 판정 */
  readonly damage: DamageModel;
  /** damage가 바뀐 노드들 (재사용 배열). 갱신 직후 onDamageChanged로 넘긴다 */
  private readonly changed: number[] = [];
  /** 손상도가 바뀌었을 때 (외관 갱신용) */
  onDamageChanged: ((nodes: readonly number[]) => void) | null = null;
  /** 떨어뜨릴 느슨한 조각 대기열 (앞쪽이 먼저) */
  private loose: number[] = [];
  private readonly queued: Uint8Array;
  private damageAcc = 0;
  /** 한 번이라도 dynamic이 된 조각 (불변 조건: 구조에서 떨어진 조각은 반드시 물리로 넘어갔어야 한다) */
  readonly everDynamic: Uint8Array;
  /** 조각 내구도 */
  readonly durability: Durability;
  /**
   * 조각이 타격을 버티며 내구도가 lost만큼 깎임 (외관·이펙트·칩 팝업용).
   * effect: 이펙트를 낼지 (폭발당 상한 maxHitEffectsPerBlast)
   */
  onDurabilityHit: ((node: number, lost: number, effect: boolean) => void) | null = null;

  /**
   * damageResponse: 손상도에 따른 반응 (느슨한 조각 낙하, 손상 부위 폭발·충돌 증폭).
   * 끄면 예전과 완전히 같은 경로 (회귀 테스트).
   * maxDurability: 조각별 최대 내구도 (없으면 전부 0 = 예전처럼 바로 깨진다).
   */
  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
    frags: readonly Fragment[],
    materials: FragmentMaterials,
    nodeInfo: (index: number) => NodeInfo,
    simpleColliderMaxVolume = 0,
    readonly damageResponse = false,
    maxDurability: Uint8Array | null = null,
  ) {
    this.durability = new Durability(maxDurability ?? new Uint8Array(frags.length));
    this.graph = StructureGraph.fromFragments(frags, nodeInfo);
    this.solver = new CollapseSolver(this.graph);
    this.queued = new Uint8Array(frags.length);
    this.everDynamic = new Uint8Array(frags.length);
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
    this.damage = new DamageModel(this.graph, this.positions, this.solver.edgeDamage);
    this.damage.ignoreNeighbors = Uint8Array.from(frags, (f) =>
      f.material === MATERIAL.glass ? 1 : 0,
    );
  }

  /** 손상도를 지금 구조로 다시 계산하고, 바뀐 노드를 알리고, 느슨한 조각을 대기열에 넣는다 */
  refreshDamage(): void {
    this.damage.update(this.changed, DAMAGE_VISUAL.changeEpsilon);
    if (this.changed.length === 0) return;
    if (this.damageResponse) {
      for (const i of this.changed) if (this.damage.isLoose(i)) this.enqueueLoose(i, false);
    }
    this.onDamageChanged?.(this.changed);
  }

  private enqueueLoose(i: number, front: boolean): void {
    if (this.queued[i]) return;
    this.queued[i] = 1;
    if (front) this.loose.unshift(i);
    else this.loose.push(i);
  }

  /** 대기열에서 스텝당 상한까지 떨어뜨린다 */
  private dropLoose(): void {
    let dropped = 0;
    while (this.loose.length > 0 && dropped < DAMAGE_VISUAL.maxLooseDropsPerStep) {
      const i = this.loose.shift()!;
      this.queued[i] = 0;
      if (!this.graph.detach(i)) continue;
      this.fragments.activate(i);
      dropped++;
    }
    if (dropped > 0) {
      this.stats.looseDrops += dropped;
      this.solver.markDirty();
    }
  }

  /**
   * 폭발: 에너지(J)로 반경을 정해 구조를 끊고 조각을 날린다. 섬 판정은 즉시 한 번 돌린다.
   * profile을 넘기면 그 반경·모양·세기로 (화염 폭발).
   * ignoreDurability: 내구도를 무시하고 깬다 (7-2 완파 피날레).
   * 반환: 파괴 반경
   */
  detonate(
    center: Vec3Like,
    energy: number,
    random?: () => number,
    profile?: BlastProfile,
    ignoreDurability = false,
  ): number {
    const radius = profile ? profile.radius : blastRadius(energy);
    const round = this.durability.begin();
    let effects = 0;
    // 조각 위치 에너지 = 폭발 에너지 × (1 - 거리/반경)² (applyExplosion과 같은 감쇠)
    const guard = ignoreDurability
      ? undefined
      : (i: number, dist: number) => {
          const falloff = Math.max(0, 1 - dist / radius);
          const lost = this.durability.hit(
            i,
            energy * falloff * falloff,
            round,
            DURABILITY.energyPerPoint,
            DURABILITY.minHitEnergy,
          );
          if (lost < 0) return false;
          if (lost > 0) {
            const effect = effects++ < DURABILITY.maxHitEffectsPerBlast;
            this.stats.durabilityHits++;
            this.onDurabilityHit?.(i, lost, effect);
          }
          return true;
        };
    for (const i of breakInBlast(this.graph, this.positions, center, radius, profile, guard)) {
      this.fragments.activate(i);
    }
    if (this.damageResponse) this.breakDamaged(center, radius, profile?.coreFraction, round);
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
    if (this.damageResponse) {
      this.refreshDamage();
      this.wakeLoose(center, radius);
    }
    return radius;
  }

  /**
   * 이미 손상된 조각은 더 넓게 떨어져 나간다: 코어 반경 비율 + damage × damagedCoreBoost.
   * (엣지가 이미 끊겨 breakInBlast가 할 일이 없어도 '맞은 반응'이 나게)
   */
  private breakDamaged(
    center: Vec3Like,
    radius: number,
    coreFraction: number | undefined,
    round: number,
  ): void {
    const g = this.graph;
    const p = this.positions;
    const base = coreFraction ?? EXPLOSION.coreFraction;
    for (let i = 0; i < g.nodeCount; i++) {
      const d = this.damage.damage[i]!;
      if (!g.attached[i] || d <= 0 || this.durability.protectedIn(i, round)) continue;
      const reach = radius * Math.min(1, base + d * DAMAGE_VISUAL.damagedCoreBoost);
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 <= reach * reach && g.detach(i)) this.fragments.activate(i);
    }
  }

  /** 폭발 여파: 넓은 범위의 손상 조각을 대기열 앞에 넣어 우수수 떨어지게 */
  private wakeLoose(center: Vec3Like, radius: number): void {
    const g = this.graph;
    const p = this.positions;
    const reach = radius * DAMAGE_VISUAL.looseWakeRange;
    for (let i = 0; i < g.nodeCount; i++) {
      if (!g.attached[i] || g.anchor[i]) continue;
      if (this.damage.damage[i]! < DAMAGE_VISUAL.looseWakeDamage) continue;
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 <= reach * reach) this.enqueueLoose(i, true);
    }
  }

  /** center 근처 손상도 (관통 저항 계산용) */
  damageNear(center: Vec3Like, radius: number): number {
    return this.damage.damageNear(center, radius);
  }

  /** 화재: 타는 서 있는 조각의 내구도를 1씩 깎는다 (BuildingFire가 fireTickSec마다) */
  wearBurning(nodes: readonly number[]): void {
    for (const i of nodes) {
      if (!this.graph.attached[i] || !this.durability.wear(i)) continue;
      this.stats.durabilityHits++;
      this.onDurabilityHit?.(i, 1, false);
    }
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
    this.damageAcc += dt;
    if (this.damageAcc >= DAMAGE_VISUAL.updateSec) {
      this.damageAcc = 0;
      this.refreshDamage();
    }
    if (this.damageResponse) this.dropLoose();
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
    // 움직이는 잔해는 발사체와 부딪히지 않는다 (굳으면 onFrozen에서 되돌린다)
    for (const c of chunk.body.colliders) c.setCollisionGroups(DEBRIS_GROUPS);
    for (const i of chunk.frags) this.everDynamic[i] = 1;
    this.onReleased?.(chunk.frags);
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
    // 굳은 잔해는 눈에 보이는 그대로 다시 맞아야 한다
    for (const c of chunk.body.colliders) c.setCollisionGroups(DEFAULT_GROUPS);
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
    const dur = this.durability;
    const inChunk = new Set(chunk.frags);
    // 내구도 블록은 착지 충격에 쪼개지지 않고 내구도만 1 깎인다 (한 번의 충격에 조각당 1회)
    const worn = new Set<number>();
    for (const i of chunk.frags) {
      for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
        const e = g.incident[k]!;
        const j = g.other(e, i);
        if (!g.alive[e] || !inChunk.has(j)) continue;
        const stress = g.capacity[e]! / Math.max(g.area[e]!, 1e-9);
        const threshold =
          STRUCTURE.impactBreakSpeed * Math.sqrt(stress / STRUCTURE.strengthPerArea);
        if (dv <= threshold) continue;
        const held = [i, j].filter((n) => dur.enabled && dur.current[n]! > 0);
        if (held.length === 0) {
          g.breakEdge(e);
          continue;
        }
        for (const n of held) {
          if (worn.has(n)) continue;
          worn.add(n);
          dur.wear(n);
          this.stats.durabilityHits++;
          this.onDurabilityHit?.(n, 1, false);
        }
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
    const mass = mover.rigidBody.mass();
    // 가벼운 잔해(유리 파편, 작은 조각)는 서 있는 조각을 떼어내지 못한다 — 유리가 연쇄로 유리를 깨지 않게
    if (mass < STRUCTURE.chainMinMass) return false;
    const energy = 0.5 * mass * speed * speed;
    // 이미 많이 손상된 조각은 작은 충돌에도 떨어진다
    const weak = this.damageResponse && this.damage.damage[i]! >= DAMAGE_VISUAL.chainDamage;
    if (!weak && energy <= STRUCTURE.chainJoulesPerKg * g.supportCapacity(i)) return false;
    // 떨어질 만한 충돌이지만 내구도가 남았으면 버티고 깎이기만 한다
    const lost = this.durability.hit(
      i,
      energy,
      this.durability.begin(),
      DURABILITY.chainEnergyPerPoint,
      DURABILITY.chainMinHitEnergy,
    );
    if (lost >= 0) {
      if (lost > 0) {
        this.stats.durabilityHits++;
        this.onDurabilityHit?.(i, lost, true);
      }
      return false;
    }
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
