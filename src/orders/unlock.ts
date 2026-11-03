// 열린 주문 등급 (Phase 10 등급 해금 자리). 지금은 튜토리얼 게이트 하나:
// 완파한 건물이 ORDERS.tutorialBuildings보다 적으면 입문(tiny) 주문만, 그 뒤로는 office 등급.
// 7-4 이전 세이브(starterComplete, 마이그레이션 v1 → v2)는 바로 office.
import { ORDERS } from '../config';
import type { CareerData } from './Career';
import { ALL_TIERS, type OrderTier } from './Order';

export function unlockedTiersFor(
  career: Pick<CareerData, 'buildingsDemolished' | 'starterComplete'>,
  tutorialBuildings: number = ORDERS.tutorialBuildings,
): readonly OrderTier[] {
  const starter = !career.starterComplete && career.buildingsDemolished < tutorialBuildings;
  return starter ? ['tiny'] : ALL_TIERS;
}
