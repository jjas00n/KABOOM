// 화재: 구조 그래프 위에서 열이 퍼지고, 타는 조각이 연결부를 약하게 만들어 지연 붕괴를 일으킨다.
// 순수 로직 (three/Rapier 의존 없음, 단위 테스트 대상). 비주얼은 fx/Fire.ts + FragmentMeshes 색.
//
// 조각 상태: heat 0~1, fuel(남은 연소 시간 s), burning, charred 0~1
//   - 착화: heat ≥ ignitionHeat 이고 연료가 있으면. 동시에 타는 조각은 maxBurning까지 (넘으면 대기)
//   - 확산: 타는 조각이 살아 있는 엣지로 이웃에 열을 준다. 위쪽 이웃은 빠르게(rateUp), 옆은 보통,
//     아래는 느리게. 대상이 슬래브면 slabFactor배 → 다른 층으로는 천천히 번진다. 공유 면적에 비례.
//   - 연소: 연료를 태우고 charred가 오른다. 다 타면 꺼지고 그을린 채로 남는다
//   - 약화: 타는 조각에 붙은 엣지의 용량(capacity)을 깎는다 (원래 값의 minStrength까지)
//     → CollapseSolver가 과부하 엣지로 보고 서서히 끊는다 = 불이 오래 붙은 층이 늦게 주저앉는다
//   - 구조에서 떨어진 조각은 퍼뜨리지 않고 계속 탄다. 굳으면 settledBurnRate배로 빨리 꺼진다
// 계산은 tickSec마다 묶어서 한다 (매 물리 스텝마다 하지 않는다).
import type { StructureGraph } from '../building/StructureGraph';
import { FIRE } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';

export interface FireSettings {
  tickSec: number;
  ignitionHeat: number;
  maxBurning: number;
  heatDecay: number;
  rateUp: number;
  rateSide: number;
  rateDown: number;
  verticalThreshold: number;
  slabFactor: number;
  areaRef: number;
  burnRate: number;
  charRate: number;
  weakenRate: number;
  minStrength: number;
  settledBurnRate: number;
}

export interface FireTickResult {
  /** 이번 update에서 엣지 용량이 줄었는지 (CollapseSolver.capacityChanged 필요) */
  weakened: boolean;
  /** 이번 update에서 상태(burning/charred)가 바뀐 노드가 있는지 (색 갱신 필요) */
  changed: boolean;
}

/** 공유 면적 비율 상한 (큰 면 하나가 확산을 독차지하지 않게) */
const MAX_AREA_WEIGHT = 1.5;

export class FireSystem {
  readonly heat: Float32Array;
  readonly fuel: Float32Array;
  readonly burning: Uint8Array;
  readonly charred: Float32Array;
  /** 확산 속도 배율 (디버그) */
  spreadMultiplier: number = FIRE.spreadMultiplier;
  /** 굳은(정지한) 떨어진 조각인지 — 빨리 꺼진다. 없으면 아무것도 안 굳은 것으로 */
  isSettled: ((node: number) => boolean) | null = null;

  private readonly settings: FireSettings;
  /** 화재 전 엣지 용량 (약화 하한 기준) */
  private readonly baseCapacity: Float32Array;
  /** 지금 타는 노드 (순서 무관) */
  private readonly list: number[] = [];
  private acc = 0;
  private dirtyColors = false;

  /**
   * fuel: 노드별 처음 연료 (FireSystem.fuelFor로 만든다), slab: 노드가 슬래브면 1
   */
  constructor(
    readonly graph: StructureGraph,
    private readonly positions: ArrayLike<number>,
    fuel: Float32Array,
    private readonly slab: Uint8Array,
    settings: Partial<FireSettings> = {},
  ) {
    this.settings = { ...FIRE, ...settings };
    const n = graph.nodeCount;
    this.heat = new Float32Array(n);
    this.fuel = fuel;
    this.burning = new Uint8Array(n);
    this.charred = new Float32Array(n);
    this.baseCapacity = graph.capacity.slice();
  }

  /**
   * 노드별 연료: 부재 종류별 값 (FIRE.fuel), 유리와 맞닿은 외벽(창대·인방·문설주)은 window 값.
   * random: ±fuelJitter 변주용 [0, 1) 난수
   */
  static fuelFor(
    graph: StructureGraph,
    kind: (node: number) => string,
    random: () => number,
  ): Float32Array {
    const n = graph.nodeCount;
    const fuel = new Float32Array(n);
    const table = FIRE.fuel;
    for (let i = 0; i < n; i++) {
      let f = table[kind(i)] ?? 0;
      if (kind(i) === 'wallPanel') {
        for (let k = graph.incidentStart[i]!; k < graph.incidentStart[i + 1]!; k++) {
          if (kind(graph.other(graph.incident[k]!, i)) === 'glass') {
            f = table.window ?? f;
            break;
          }
        }
      }
      fuel[i] = f * (1 + FIRE.fuelJitter * (2 * random() - 1));
    }
    return fuel;
  }

  get burningCount(): number {
    return this.list.length;
  }

  /** 지금 타는 노드들 (읽기 전용으로 쓸 것) */
  get burningNodes(): readonly number[] {
    return this.list;
  }

  /** center에서 radius 안 노드에 열을 준다 (선형 감쇠). 착화는 다음 틱에 */
  addHeat(center: Vec3Like, radius: number, amount: number): void {
    const p = this.positions;
    const r2 = radius * radius;
    for (let i = 0; i < this.graph.nodeCount; i++) {
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 > r2) continue;
      this.heat[i] = Math.min(1, this.heat[i]! + amount * (1 - Math.sqrt(d2) / radius));
    }
  }

  /** radius 안에 타는 노드가 있는지 (대포 폭발이 불씨를 튀길지 판단) */
  burningNear(center: Vec3Like, radius: number): boolean {
    const p = this.positions;
    const r2 = radius * radius;
    for (const i of this.list) {
      const d2 =
        (p[i * 3]! - center.x) ** 2 +
        (p[i * 3 + 1]! - center.y) ** 2 +
        (p[i * 3 + 2]! - center.z) ** 2;
      if (d2 <= r2) return true;
    }
    return false;
  }

  /** 즉시 진화: 전부 끄고 열을 없앤다 (그을림·약화는 남는다) */
  extinguishAll(): void {
    for (const i of this.list) this.burning[i] = 0;
    this.list.length = 0;
    this.heat.fill(0);
    this.dirtyColors = true;
  }

  /** 물리 시간 dt만큼. 계산은 tickSec 단위로 묶는다 */
  update(dt: number): FireTickResult {
    const result: FireTickResult = { weakened: false, changed: this.dirtyColors };
    this.dirtyColors = false;
    this.acc += dt;
    const h = this.settings.tickSec;
    while (this.acc >= h) {
      this.acc -= h;
      this.tick(h, result);
    }
    return result;
  }

  private tick(h: number, result: FireTickResult): void {
    const s = this.settings;
    const g = this.graph;
    const { heat, fuel, burning, charred } = this;

    // 1) 타는 조각: 연소 + 확산 + 약화
    for (let k = this.list.length - 1; k >= 0; k--) {
      const i = this.list[k]!;
      const attached = g.attached[i] === 1;
      const settled = !attached && (this.isSettled?.(i) ?? false);
      fuel[i] = fuel[i]! - s.burnRate * (settled ? s.settledBurnRate : 1) * h;
      charred[i] = Math.min(1, charred[i]! + s.charRate * h);
      heat[i] = 1;
      if (attached) {
        if (this.spread(i, h)) result.weakened = true;
      }
      if (fuel[i]! <= 0) {
        fuel[i] = 0;
        burning[i] = 0;
        heat[i] = s.ignitionHeat * 0.5; // 꺼진 직후 다시 붙지 않게
        this.list[k] = this.list[this.list.length - 1]!;
        this.list.pop();
        result.changed = true;
      }
    }

    // 2) 식기 + 착화 (상한까지)
    const decay = s.heatDecay * h;
    for (let i = 0; i < g.nodeCount; i++) {
      if (burning[i]) continue;
      if (heat[i]! >= s.ignitionHeat && fuel[i]! > 0) {
        if (this.list.length >= s.maxBurning) continue; // 대기: heat는 유지
        burning[i] = 1;
        this.list.push(i);
        result.changed = true;
      } else if (heat[i]! > 0) {
        heat[i] = Math.max(0, heat[i]! - decay);
      }
    }
  }

  /** 타는 노드 i가 이웃에 열을 주고 붙은 엣지를 약하게 한다. 반환: 용량이 줄었는지 */
  private spread(i: number, h: number): boolean {
    const s = this.settings;
    const g = this.graph;
    let weakened = false;
    for (let k = g.incidentStart[i]!; k < g.incidentStart[i + 1]!; k++) {
      const e = g.incident[k]!;
      if (!g.alive[e]) continue;
      const j = g.other(e, i);
      // i → j 방향의 수직 성분 (edgeRise = b.y - a.y)
      const rise = (g.edgeA[e] === i ? g.edgeRise[e]! : -g.edgeRise[e]!) / g.edgeLength[e]!;
      let rate =
        rise >= s.verticalThreshold
          ? s.rateUp
          : rise <= -s.verticalThreshold
            ? s.rateDown
            : s.rateSide;
      if (this.slab[j] && !this.slab[i]) rate *= s.slabFactor;
      const w = Math.min(g.area[e]! / s.areaRef, MAX_AREA_WEIGHT);
      if (!this.burning[j])
        this.heat[j] = Math.min(1, this.heat[j]! + rate * w * this.spreadMultiplier * h);

      const floor = this.baseCapacity[e]! * s.minStrength;
      const cap = g.capacity[e]!;
      if (cap > floor) {
        g.capacity[e] = Math.max(floor, cap - this.baseCapacity[e]! * s.weakenRate * h);
        weakened = true;
      }
    }
    return weakened;
  }
}
