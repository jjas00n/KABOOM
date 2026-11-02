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
}

export function emptyCareer(): CareerData {
  return { buildingsDemolished: 0, ordersAbandoned: 0, totalFragments: 0, best: null };
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
