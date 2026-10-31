// 완파 피날레 진행 (연출 시간표 + 남은 건물 정리). 헤드리스로도 돌아간다 (sink 없이 테스트).
//
//   begin()        남은 조각 가치 전부를 'finale'로 한 번에 정산 + 완료 보너스. 붕괴 순서·물리 조각을 정한다
//   stepCollapse() 물리 스텝마다: 웨이브 높이(꼭대기 - waveSpeed × t)보다 위의 조각을 스텝당 상한까지 분리한다
//                  - 물리 조각(부피 큰 순, 동시 dynamic 상한 안): dynamic + 바깥으로 밀기
//                  - 나머지: 바로 숨기고 같은 자리·크기·색의 GPU 파편으로 대체 (눈으로는 전부 터진다).
//                    물리 바디 제거(Rapier)는 비싸서 대기열에 넣고 스텝마다 removalsPerStep개씩 지운다
//                    (숨긴 바디는 웨이브 위쪽이라 아래로 떨어지는 잔해와 부딪히지 않는다)
//   finishNow()    스킵: 남은 조각을 한 번에 같은 방식으로 정리
// 내구도는 무시한다 (graph.detach 직접 — 직접 타격 경로가 아니다).
import { Color, Vector3 } from 'three';
import { CONCRETE, FINALE, GLASS } from '../config';
import type { DestructionSystem } from '../destruction/DestructionSystem';
import type { Economy } from '../economy/Economy';
import { MATERIAL } from '../fracture/Fragment';
import type { Vec3Like } from '../fracture/polyhedron';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

/** 피날레가 화면에 내보내는 것 (게임에서는 Effects, 테스트에서는 없음) */
export interface FinaleSink {
  burst(at: Vec3Like, velocity: Vec3Like, size: number, color: Color): void;
  dust(center: Vec3Like, radius: number): void;
}

export interface FinaleReward {
  /** 남은 조각 정산 */
  finale: number;
  /** 완료 보너스 */
  bonus: number;
}

const CONCRETE_COLOR = new Color(CONCRETE.exteriorColor);
const GLASS_COLOR = new Color(GLASS.color);
const color = new Color();
const vel = new Vector3();
const out = new Vector3();
const at = new Vector3();

export class Finale {
  /** 붕괴 순서 (높은 것부터) */
  private readonly order: number[] = [];
  private readonly physical: Uint8Array;
  private next = 0;
  private waveY = 0;
  private readonly center = new Vector3();
  /** 웨이브가 지난 층 높이 (먼지 구름 간격) */
  private dustY = Infinity;
  /** 숨겼지만 아직 물리에서 안 지운 바디 */
  private readonly removals: PhysicsBody[] = [];
  private removalHead = 0;
  /** 지금까지 분리한 조각 (물리 / 파편) */
  readonly counts = { physical: 0, particles: 0, maxPerStep: 0 };

  constructor(
    private readonly system: DestructionSystem,
    private readonly physics: PhysicsWorld,
    private readonly economy: Economy,
    private readonly sink: FinaleSink | null = null,
  ) {
    this.physical = new Uint8Array(system.graph.nodeCount);
  }

  /** 붕괴가 끝났는지 (서 있는 조각이 기초뿐) */
  get collapsed(): boolean {
    return this.next >= this.order.length;
  }

  /** 숨긴 조각의 물리 바디가 아직 남았는지 */
  get pendingRemovals(): number {
    return this.removals.length - this.removalHead;
  }

  /** 숨긴 조각의 물리 바디를 max개까지 지운다 */
  drainRemovals(max: number): void {
    const s = this.system;
    for (let k = 0; k < max && this.removalHead < this.removals.length; k++) {
      s.forget(this.removals[this.removalHead++]!);
    }
  }

  /** 정산과 붕괴 준비. 반환: 지급액 */
  begin(): FinaleReward {
    const g = this.system.graph;
    const p = this.system.positions;
    const ledger = this.economy.ledger;
    const finale = ledger ? (this.economy.releaseFinale(ledger.unpaid())?.amount ?? 0) : 0;
    const bonus = this.economy.payCompletionBonus(FINALE.completionBonusFraction);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let top = 0;
    for (let i = 0; i < g.nodeCount; i++) {
      if (!g.attached[i] || g.anchor[i]) continue;
      this.order.push(i);
      minX = Math.min(minX, p[i * 3]!);
      maxX = Math.max(maxX, p[i * 3]!);
      minZ = Math.min(minZ, p[i * 3 + 2]!);
      maxZ = Math.max(maxZ, p[i * 3 + 2]!);
      top = Math.max(top, p[i * 3 + 1]!);
    }
    this.order.sort((a, b) => p[b * 3 + 1]! - p[a * 3 + 1]!);
    this.center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.waveY = top;
    this.dustY = top;

    // 물리로 떨어뜨릴 조각: 부피 큰 순, 동시 dynamic 상한 안에서
    const frags = this.system.fragments.fragments;
    const budget = Math.max(
      0,
      Math.min(FINALE.maxPhysics, FINALE.maxDynamicTotal - this.physics.movingCount),
    );
    const byVolume = [...this.order].sort((a, b) => frags[b]!.volume - frags[a]!.volume);
    for (let k = 0; k < budget && k < byVolume.length; k++) this.physical[byVolume[k]!] = 1;
    return { finale, bonus };
  }

  /** 물리 스텝마다 (물리 시간 dt): 웨이브를 내리고 지나간 조각을 상한까지 분리 */
  stepCollapse(dt: number): void {
    this.waveY -= FINALE.waveSpeed * dt;
    const p = this.system.positions;
    let n = 0;
    while (
      !this.collapsed &&
      n < FINALE.maxDetachPerStep &&
      p[this.order[this.next]! * 3 + 1]! >= this.waveY
    ) {
      this.release(this.order[this.next++]!);
      n++;
    }
    this.counts.maxPerStep = Math.max(this.counts.maxPerStep, n);
    if (n > 0) this.system.solver.markDirty();
    this.drainRemovals(FINALE.removalsPerStep);
    // 웨이브가 한 층(3m)씩 내려갈 때마다 큰 먼지 구름
    if (this.sink && this.waveY < this.dustY - 3) {
      this.dustY = this.waveY;
      for (let k = 0; k < FINALE.dustPuffsPerFloor; k++) {
        const a = (k / FINALE.dustPuffsPerFloor) * Math.PI * 2;
        at.set(
          this.center.x + Math.cos(a) * 8,
          Math.max(this.waveY, 1),
          this.center.z + Math.sin(a) * 8,
        );
        this.sink.dust(at, 6);
      }
    }
  }

  /** 스킵: 남은 조각을 한 번에 */
  finishNow(): void {
    while (!this.collapsed) this.release(this.order[this.next++]!);
    this.system.solver.markDirty();
  }

  private release(i: number): void {
    const s = this.system;
    if (!s.graph.attached[i] || !s.graph.detach(i)) return;
    const frag = s.fragments.fragments[i]!;
    const c = frag.centroid;
    // 바깥(건물 중심에서 멀어지는 수평) + 위
    out.set(c.x - this.center.x, 0, c.z - this.center.z);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    out.normalize();
    if (this.physical[i]) {
      s.fragments.activate(i);
      const body = s.fragments.chunkOf[i]?.body;
      body?.rigidBody.setLinvel(
        { x: out.x * FINALE.pushSpeed, y: FINALE.pushSpeed * 0.3, z: out.z * FINALE.pushSpeed },
        true,
      );
      this.counts.physical++;
      return;
    }
    const chunk = s.fragments.chunkOf[i];
    if (chunk) {
      // 지금은 숨기기만 (싸다). 바디 제거는 drainRemovals가 나눠서
      for (const { batch, id } of s.fragments.meshes.slots[i]!) batch.setVisibleAt(id, false);
      this.removals.push(chunk.body);
    }
    this.counts.particles++;
    if (!this.sink) return;
    const meshes = s.fragments.meshes;
    const glass = frag.material === MATERIAL.glass;
    color.copy(glass ? GLASS_COLOR : CONCRETE_COLOR);
    if (!glass) {
      color.r *= meshes.tint[i * 4]! * meshes.base[i * 3]!;
      color.g *= meshes.tint[i * 4 + 1]! * meshes.base[i * 3 + 1]!;
      color.b *= meshes.tint[i * 4 + 2]! * meshes.base[i * 3 + 2]!;
    }
    const speed = FINALE.burstSpeed * (0.3 + 0.7 * Math.random());
    vel.set(
      out.x * speed + (Math.random() - 0.5) * 2,
      FINALE.burstUp * Math.random(),
      out.z * speed + (Math.random() - 0.5) * 2,
    );
    this.sink.burst(c, vel, Math.cbrt(frag.volume) * 1.1, color);
  }
}
