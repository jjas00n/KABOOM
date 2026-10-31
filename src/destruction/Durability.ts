// 조각 내구도 (순수 로직): 직접 타격에 버티는 정수 '체력'.
//   - 최대 내구도 0인 조각은 지금처럼 바로 깨진다
//   - 1 이상이면 타격마다 내구도만 깎이고 버틴다. 0이 된 뒤 다음 타격에서 깨진다
//   - 한 번의 폭발(blast id)에서 같은 조각은 1회만 판정한다
//   - 약한 충격(minHit 미만)은 버티되 깎이지 않는다
// 지지 상실·과부하·느슨 낙하는 여기를 거치지 않는다 → 내구도가 있어도 받침이 없으면 떨어진다.
import { DURABILITY } from '../config';
import { createRng } from '../fracture/seeds';

/** hit 결과: 버티지 못함 (평소대로 깨진다) */
export const NOT_PROTECTED = -1;

export class Durability {
  readonly current: Uint8Array;
  readonly max: Uint8Array;
  /** false면 모든 조각이 내구도 0처럼 (비교·측정용) */
  enabled: boolean = DURABILITY.enabled;
  private readonly stamp: Uint32Array;
  /** 같은 판정 회차에서 이미 버틴 조각의 결과 (stamp가 같을 때만 유효) */
  private readonly verdict: Int8Array;
  private round = 0;

  constructor(max: Uint8Array) {
    this.max = max;
    this.current = max.slice();
    this.stamp = new Uint32Array(max.length);
    this.verdict = new Int8Array(max.length);
  }

  /**
   * 초기 최대 내구도: 부재별 기본값 + seed 기반 ±1 지터 + 보너스 (기본값 0인 부재와 앵커는 0).
   * 같은 seed·같은 입력이면 같은 결과.
   */
  static initial(
    count: number,
    kind: (i: number) => string,
    anchor: (i: number) => boolean,
    seed: number,
    bonus = 0,
  ): Uint8Array {
    const out = new Uint8Array(count);
    const rng = createRng((seed ^ DURABILITY.seedSalt) >>> 0);
    for (let i = 0; i < count; i++) {
      const roll = rng(); // 자격과 무관하게 매번 뽑아 조각 번호마다 결과가 고정되게
      const base = DURABILITY.byKind[kind(i)] ?? 0;
      if (base <= 0 || anchor(i)) continue;
      let v = base + bonus;
      if (roll < DURABILITY.jitterUp) v++;
      else if (roll > 1 - DURABILITY.jitterDown) v--;
      out[i] = Math.max(0, Math.min(255, v));
    }
    return out;
  }

  /** 새 판정 회차 (폭발 하나, 착지 분해 하나 등). 반환: 회차 id */
  begin(): number {
    this.round = (this.round + 1) >>> 0 || 1;
    return this.round;
  }

  /**
   * 조각 i가 energy(J)짜리 타격을 받음. 반환: 깎인 양(0 이상, 버팀) 또는 NOT_PROTECTED(깨진다).
   * 같은 회차에서 두 번 불려도 결과는 처음 것 (중복 감소 없음).
   */
  hit(i: number, energy: number, round: number, perPoint: number, minHit: number): number {
    if (this.stamp[i] === round) return this.verdict[i]!;
    this.stamp[i] = round;
    let result: number;
    if (!this.enabled || this.max[i] === 0 || this.current[i] === 0) {
      result = NOT_PROTECTED;
    } else if (energy < minHit) {
      result = 0;
    } else {
      const lost = Math.min(this.current[i]!, Math.max(1, Math.ceil(energy / perPoint)));
      this.current[i] = this.current[i]! - lost;
      result = lost;
    }
    this.verdict[i] = result;
    return result;
  }

  /** 이번 회차에서 버텼는지 (hit이 0 이상을 돌려줬는지) */
  protectedIn(i: number, round: number): boolean {
    return this.stamp[i] === round && this.verdict[i]! >= 0;
  }

  /** 1만큼 깎는다 (화재·착지). 이미 0이면 false */
  wear(i: number): boolean {
    if (!this.enabled || this.current[i] === 0) return false;
    this.current[i] = this.current[i]! - 1;
    return true;
  }

  /** 깎인 비율 0~1 (최대 0이면 0) */
  lossFraction(i: number): number {
    const m = this.max[i]!;
    return m > 0 ? 1 - this.current[i]! / m : 0;
  }
}
