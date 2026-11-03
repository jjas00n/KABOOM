// 누적 통계 (순수 로직, 저장된다): 부순 건물 수, 포기한 의뢰 수, 총 파편, 최대 수익 건물.

export interface CareerData {
  /** 완파한 건물 수 */
  buildingsDemolished: number;
  /** 포기한 의뢰 수 */
  ordersAbandoned: number;
  /** 지금까지 돈이 된 파편(조각) 수 (포기한 의뢰 포함) */
  totalFragments: number;
  /** 수익이 가장 컸던 완파 건물 */
  best: { name: string; total: number } | null;
  /**
   * 입문(tiny) 단계를 건너뛰었는지 (7-4 이전 세이브: 이미 office를 하던 플레이어는 계속 office).
   * 새 게임은 false → 완파 ORDERS.tutorialBuildings채까지 입문 주문만 (orders/unlock.ts)
   */
  starterComplete: boolean;
}

export function emptyCareer(): CareerData {
  return {
    buildingsDemolished: 0,
    ordersAbandoned: 0,
    totalFragments: 0,
    best: null,
    starterComplete: false,
  };
}

export class Career {
  constructor(public data: CareerData = emptyCareer()) {}

  /** 완파 (결과 화면). total: 이번 건물 수익, fragments: 지급된 조각 수 */
  recordCompleted(name: string, total: number, fragments: number): void {
    const d = this.data;
    d.buildingsDemolished++;
    d.totalFragments += fragments;
    if (!d.best || total > d.best.total) d.best = { name, total };
  }

  /** 의뢰 포기: 그때까지 번 파편 수만 */
  recordAbandoned(fragments: number): void {
    this.data.ordersAbandoned++;
    this.data.totalFragments += fragments;
  }
}
