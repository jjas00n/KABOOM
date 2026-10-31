// 건물 한 채의 장부: 조각별 바탕 가치, 지급 여부, 파괴율. 순수 로직 (물리·렌더 모름).
//   - 조각마다 한 번만 지급한다 (paid). 같은 조각이 다시 깨어나 dynamic이 돼도 0
//   - 파괴율 = 분리된(지급된) 질량 / 가치 있는 조각의 전체 질량 (기초 등 단가 0인 조각은 분모에서도 빠진다)
import { DURABILITY } from '../config';
import { fragmentValue, rollRare, unitPrice } from './FragmentValue';

export interface LedgerNodes {
  count: number;
  /** 조각 질량 (kg) */
  mass: ArrayLike<number>;
  /** 부재 종류 (foundation, wallPanel, …) */
  kind: (i: number) => string;
  /** 재질 (concrete, glass) */
  material: (i: number) => string;
  /** 최대 내구도 (없으면 0): 가치 × (1 + valuePerPoint × 최대 내구도) */
  durability?: (i: number) => number;
}

export interface Payout {
  /** 이번에 처음 지급된 조각 수 */
  count: number;
  /** 지급액 합 ($) */
  amount: number;
  /** 그중 희귀 조각 수 */
  rare: number;
}

export class BuildingLedger {
  /** 배율 적용 전 조각 가치 (희귀 배수 포함) */
  readonly baseValue: Float64Array;
  /** 수익·파괴율 대상 (단가 > 0) */
  readonly counted: Uint8Array;
  readonly paid: Uint8Array;
  readonly rare: Uint8Array;
  readonly mass: Float64Array;
  /** 대상 조각 질량 합 (kg) */
  readonly totalMass: number;
  /** 지급(분리)된 질량 합 (kg) */
  paidMass = 0;
  /** 지급액 합 (배율 적용 후, $) */
  paidAmount = 0;
  /** 대상 조각 바탕 가치 합 (배율 전, $): 완료 보너스 기준 */
  readonly totalValue: number;

  constructor(nodes: LedgerNodes, seed: number, rareEnabled?: boolean) {
    const n = nodes.count;
    this.mass = Float64Array.from({ length: n }, (_, i) => nodes.mass[i]!);
    this.counted = new Uint8Array(n);
    this.paid = new Uint8Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (unitPrice(nodes.kind(i), nodes.material(i)) <= 0) continue;
      this.counted[i] = 1;
      total += this.mass[i]!;
    }
    this.totalMass = total;
    this.rare = rollRare(n, seed, (i) => this.counted[i] === 1, rareEnabled);
    this.baseValue = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.baseValue[i] =
        fragmentValue(this.mass[i]!, nodes.kind(i), nodes.material(i), 1, this.rare[i] === 1) *
        (1 + DURABILITY.valuePerPoint * (nodes.durability?.(i) ?? 0));
    }
    let value = 0;
    for (let i = 0; i < n; i++) if (this.counted[i]) value += this.baseValue[i]!;
    this.totalValue = value;
  }

  /**
   * 조각들이 분리됨: 아직 지급 안 된 대상 조각만 가치 × multiplier를 지급 처리한다.
   * each: 지급된 조각마다 (팝업 등). 반환: 이번 지급 합계
   */
  release(
    nodes: readonly number[],
    multiplier: number,
    each?: (node: number, amount: number) => void,
  ): Payout {
    const out: Payout = { count: 0, amount: 0, rare: 0 };
    for (const i of nodes) {
      if (this.paid[i] || !this.counted[i]) continue;
      this.paid[i] = 1;
      const amount = this.baseValue[i]! * multiplier;
      out.count++;
      out.amount += amount;
      if (this.rare[i]) out.rare++;
      this.paidMass += this.mass[i]!;
      each?.(i, amount);
    }
    this.paidAmount += out.amount;
    return out;
  }

  /** 파괴율 0~1 */
  get destructionRate(): number {
    return this.totalMass > 0 ? Math.min(1, this.paidMass / this.totalMass) : 0;
  }

  /** 아직 지급 안 된 대상 조각 (7-2 피날레 정산용) */
  unpaid(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.paid.length; i++) if (this.counted[i] && !this.paid[i]) out.push(i);
    return out;
  }
}
