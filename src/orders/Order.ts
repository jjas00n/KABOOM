// 철거 의뢰 한 장 (순수 데이터). OrderGenerator가 게시판 seed로 만든다.
import type { BuildingParams } from '../building/BuildingGenerator';
import type { QualityPreset } from '../config';
import type { PriceScale } from '../economy/FragmentValue';

/** 크기 등급: 규모·보상 (Phase 10에서 해금이 붙는다) */
export type OrderTier = 'small' | 'medium' | 'large';
export const ALL_TIERS: readonly OrderTier[] = ['small', 'medium', 'large'];

/** 특징: 모양과 전략 (카드마다 하나) */
export type OrderTrait = 'glassy' | 'slender' | 'sprawling' | 'reinforced';
export const ALL_TRAITS: readonly OrderTrait[] = ['glassy', 'slender', 'sprawling', 'reinforced'];

export interface Order {
  /** `${게시판 seed}-${카드 번호}` */
  id: string;
  /** 가상의 건물명 / 의뢰인 */
  name: string;
  client: string;
  tier: OrderTier;
  trait: OrderTrait;
  /** 건물 파라미터 (seed 포함) */
  building: BuildingParams;
  /** 조각 예산 배율 (품질 프리셋 목표 조각 수 × 이 값) */
  budgetScale: number;
  /** 주문 배율 (Modifiers 'order') */
  rewardMultiplier: number;
  /** 완료 보너스 = 건물 전체 가치 × 이 값 */
  completionBonus: number;
  /** 재질 단가 배율 */
  priceScale: PriceScale;
  /** 품질별 예상 조각 수 */
  estimatedFragments: Record<QualityPreset, number>;
  /** 품질별 예상 총수익 (완파 + 보너스, 내구도·희귀 제외 근사) */
  estimatedPayout: Record<QualityPreset, number>;
}
