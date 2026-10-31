// 조각별 손상도(damage 0~1)와 손상 자세(틈·처짐·기울어짐), 느슨한 조각 판정. 순수 로직.
//
// damage = w1·끊긴 연결 면적 비율 + w2·붙은 엣지 누적손상 평균 + w3·화재 약화 평균 (0~1로 자름)
//   떨어져 나간 조각은 1.
// 자세 (원래 자리 기준 오프셋, 서 있는 조각만):
//   - 틈: 끊긴 이웃에게서 멀어지는 방향(공유 면적 가중) × damage × gapMax
//   - 처짐: 아래쪽 지지 면적을 잃은 비율 × damage × sagMax (−y)
//   - 기울어짐: 외장재는 건물 바깥 쪽으로 위가 기운다 (tiltMax × damage)
// 그래프의 positions(원래 자리)는 바꾸지 않는다 — 구조 계산은 원래 자리 기준 그대로다.
// ignoreNeighbors(유리)와의 연결은 콘크리트 조각의 손상으로 치지 않는다: 창유리가 빠져도 창틀은 멀쩡하다.
import { Quaternion, Vector3 } from 'three';
import type { StructureGraph } from '../building/StructureGraph';
import { DAMAGE_VISUAL } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';

export interface DamageSettings {
  weightBroken: number;
  weightStrain: number;
  weightFire: number;
  gapMax: number;
  sagMax: number;
  tiltMax: number;
  looseFactor: number;
  looseMaxEdges: number;
  looseDamage: number;
}

/** 이웃 방향의 수직 성분이 이 이하면 '아래쪽 이웃' (지지) */
const BELOW = -0.5;
const UP = new Vector3(0, 1, 0);
const dir = new Vector3();
const axis = new Vector3();

export class DamageModel {
  readonly damage: Float32Array;
  /** 서 있지만 엣지가 1~2개만 남은 조각 (흔들림) */
  readonly hanging: Uint8Array;
  /** 아래쪽 지지 면적을 잃은 비율 0~1 */
  readonly sagging: Float32Array;
  private readonly settings: DamageSettings;
  /** 손상 전 엣지 용량 (화재 약화 비율 기준) */
  private readonly baseCapacity: Float32Array;
  /** 노드별 원래 아래쪽 이웃 면적 */
  private readonly belowArea: Float32Array;
  private readonly center = new Vector3();
  /** 이 노드들(유리)과의 연결은 다른 노드의 손상 계산에서 뺀다 (자기 자신이 유리면 그대로 센다) */
  ignoreNeighbors: Uint8Array | null = null;

  /**
   * positions: 노드 원래 질량중심 xyz, edgeDamage: CollapseSolver 엣지 누적손상 (없으면 0),
   * cladding: 외장재 노드 (기울어짐 대상)
   */
  constructor(
    readonly graph: StructureGraph,
    private readonly positions: ArrayLike<number>,
    private readonly edgeDamage: Float32Array | null = null,
    settings: Partial<DamageSettings> = {},
  ) {
    this.settings = { ...DAMAGE_VISUAL, ...settings };
    const n = graph.nodeCount;
    this.damage = new Float32Array(n);
    this.hanging = new Uint8Array(n);
    this.sagging = new Float32Array(n);
    this.baseCapacity = graph.capacity.slice();
    this.belowArea = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      for (let k = graph.incidentStart[i]!; k < graph.incidentStart[i + 1]!; k++) {
        const e = graph.incident[k]!;
        if (this.riseTo(e, i) <= BELOW) this.belowArea[i]! += graph.area[e]!;
      }
    }
    // 기울어짐 방향 기준: 노드 외곽 상자 중심
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, positions[i * 3]!);
      maxX = Math.max(maxX, positions[i * 3]!);
      minZ = Math.min(minZ, positions[i * 3 + 2]!);
      maxZ = Math.max(maxZ, positions[i * 3 + 2]!);
    }
    this.center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }

  /**
   * 모든 노드의 damage를 다시 계산한다. changed: 이전 값과 epsilon 넘게 달라진 노드를 넣는다.
   * 반환: 바뀐 노드 수
   */
  update(changed: number[], epsilon = 0): number {
    const g = this.graph;
    const s = this.settings;
    changed.length = 0;
    for (let i = 0; i < g.nodeCount; i++) {
      let d = 1;
      let hanging = 0;
      let sag = 0;
      if (g.attached[i]) {
        let total = 0;
        let aliveArea = 0;
        let aliveEdges = 0;
        let strain = 0;
        let weaken = 0;
        let lostBelow = 0;
        for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
          const e = g.incident[k]!;
          if (this.ignored(e, i)) continue;
          total += g.area[e]!;
          if (g.alive[e]) {
            aliveEdges++;
            aliveArea += g.area[e]!;
            strain += this.edgeDamage?.[e] ?? 0;
            const base = this.baseCapacity[e]!;
            if (base > 0) weaken += Math.max(0, 1 - g.capacity[e]! / base);
          } else if (this.riseTo(e, i) <= BELOW) {
            lostBelow += g.area[e]!;
          }
        }
        const broken = total > 0 ? 1 - aliveArea / total : 0;
        const avg = aliveEdges > 0 ? 1 / aliveEdges : 0;
        d = Math.min(
          1,
          s.weightBroken * broken + s.weightStrain * strain * avg + s.weightFire * weaken * avg,
        );
        if (g.anchor[i]) d = Math.min(d, broken); // 기초는 조금만
        hanging = !g.anchor[i] && broken > 0 && aliveEdges <= 2 ? 1 : 0;
        const below = this.belowArea[i]!;
        sag = below > 0 ? lostBelow / below : 0;
      }
      const prev = this.damage[i]!;
      this.damage[i] = d;
      this.hanging[i] = hanging;
      this.sagging[i] = sag;
      if (Math.abs(d - prev) > epsilon) changed.push(i);
    }
    return changed.length;
  }

  /**
   * 서 있는 노드 i의 손상 자세: 원래 자리 대비 이동(offset)과 회전(quat).
   * cladding이면 바깥으로 기운다. damage 0이면 단위 자세.
   */
  pose(i: number, cladding: boolean, offset: Vector3, quat: Quaternion): void {
    const g = this.graph;
    const s = this.settings;
    const d = this.damage[i]!;
    offset.set(0, 0, 0);
    quat.identity();
    if (!g.attached[i] || d <= 0) return;
    const p = this.positions;
    const total = g.nodeArea[i]! || 1;
    for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
      const e = g.incident[k]!;
      if (g.alive[e] || this.ignored(e, i)) continue;
      const j = g.other(e, i);
      dir
        .set(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!)
        .normalize();
      offset.addScaledVector(dir, g.area[e]! / total);
    }
    // 위로 밀려 올라가지는 않게 (틈은 옆·아래로)
    offset.y = Math.min(offset.y, 0);
    const len = offset.length();
    if (len > 1) offset.divideScalar(len);
    offset.multiplyScalar(s.gapMax * d);
    offset.y -= s.sagMax * this.sagging[i]! * d;
    if (cladding) {
      // 바깥 = 건물 중심에서 노드로 향하는 수평 방향의 주축
      const dx = p[i * 3]! - this.center.x;
      const dz = p[i * 3 + 2]! - this.center.z;
      if (Math.abs(dx) > Math.abs(dz)) dir.set(Math.sign(dx), 0, 0);
      else dir.set(0, 0, Math.sign(dz));
      axis.crossVectors(UP, dir); // 이 축으로 +각 회전하면 위쪽이 바깥으로
      quat.setFromAxisAngle(axis, s.tiltMax * d * (0.4 + 0.6 * this.sagging[i]!));
    }
  }

  /** 서 있는 노드 i가 너무 약해 떨어져야 하는지 */
  isLoose(i: number): boolean {
    const g = this.graph;
    if (!g.attached[i] || g.anchor[i]) return false;
    const s = this.settings;
    let aliveEdges = 0;
    let capacity = 0;
    for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
      const e = g.incident[k]!;
      if (!g.alive[e]) continue;
      aliveEdges++;
      capacity += g.capacity[e]!;
    }
    if (aliveEdges === 0) return true;
    if (this.damage[i]! <= 0) return false;
    if (capacity < g.mass[i]! * s.looseFactor) return true;
    return aliveEdges <= s.looseMaxEdges && this.damage[i]! >= s.looseDamage;
  }

  /** center 반경 안 노드의 평균 damage (떨어져 나간 조각 = 1). 노드가 없으면 0 */
  damageNear(center: Vec3Like, radius: number): number {
    const p = this.positions;
    const r2 = radius * radius;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < this.graph.nodeCount; i++) {
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 > r2) continue;
      sum += this.damage[i]!;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  /** 엣지 e(노드 i 쪽에서 본)를 손상 계산에서 뺄지: 이웃이 유리이고 나는 유리가 아니면 */
  private ignored(e: number, i: number): boolean {
    const skip = this.ignoreNeighbors;
    return skip !== null && !skip[i] && skip[this.graph.other(e, i)] === 1;
  }

  /** 노드 i에서 엣지 e 너머 이웃으로의 방향 수직 성분 (-1~1) */
  private riseTo(e: number, i: number): number {
    const g = this.graph;
    const rise = g.edgeA[e] === i ? g.edgeRise[e]! : -g.edgeRise[e]!;
    return g.edgeLength[e]! > 0 ? rise / g.edgeLength[e]! : 0;
  }
}
