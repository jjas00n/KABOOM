// 지갑: 현재 돈과 누적 수익. 지금은 쓰는 곳이 없다 (Phase 10 업그레이드). 7-3에서 저장된다.

/** 수익 출처: 파편 분리(파괴) / 완파 피날레 / 주문 완료 보너스 */
export type IncomeSource = 'fragments' | 'finale' | 'bonus';

export class Wallet {
  /** 지금 가진 돈 */
  money = 0;
  /** 지금까지 번 돈 전부 (쓴 돈과 무관) */
  lifetimeEarned = 0;
  /** 이번 건물에서 번 돈 (출처별) */
  readonly building: Record<IncomeSource, number> = { fragments: 0, finale: 0, bonus: 0 };

  add(amount: number, source: IncomeSource): void {
    if (!(amount > 0)) return;
    this.money += amount;
    this.lifetimeEarned += amount;
    this.building[source] += amount;
  }

  /** 이번 건물 수익 합계 */
  get buildingTotal(): number {
    return this.building.fragments + this.building.finale + this.building.bonus;
  }

  /** 새 건물: 이번 건물 수익만 0으로 (돈·누적은 유지) */
  startBuilding(): void {
    this.building.fragments = 0;
    this.building.finale = 0;
    this.building.bonus = 0;
  }
}
