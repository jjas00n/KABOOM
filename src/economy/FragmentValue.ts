// 조각 가치 (순수 함수):
//   가치 = max(질량 × 단가, 최소 가치) × 배율(Modifiers: 주문 배율 등) × (희귀면 rareMultiplier)
//   단가는 부재 종류(kind)가 우선 (기초 0), 없으면 재질(concrete / glass). 단가 0이면 가치 0 (최소 가치 없음).
import { ECONOMY } from '../config';
import { createRng } from '../fracture/seeds';

export interface PriceTable {
  pricePerKg: Readonly<Record<string, number>>;
  kindPricePerKg: Readonly<Record<string, number>>;
  minValue: number;
  rareMultiplier: number;
}

/** 조각 하나의 단가 ($/kg) */
export function unitPrice(kind: string, material: string, table: PriceTable = ECONOMY): number {
  return table.kindPricePerKg[kind] ?? table.pricePerKg[material] ?? 0;
}

/** 조각 하나의 가치 ($). multiplier: Modifiers.total */
export function fragmentValue(
  mass: number,
  kind: string,
  material: string,
  multiplier: number,
  rare: boolean,
  table: PriceTable = ECONOMY,
): number {
  const price = unitPrice(kind, material, table);
  if (price <= 0) return 0;
  const base = Math.max(mass * price, table.minValue);
  return base * multiplier * (rare ? table.rareMultiplier : 1);
}

/**
 * 희귀 파편 표시 (건물 seed로 결정 → 같은 건물이면 같은 조각). 꺼져 있으면 전부 0.
 * eligible: 가치가 있는 조각만 (기초 제외)
 */
export function rollRare(
  count: number,
  seed: number,
  eligible: (i: number) => boolean,
  enabled: boolean = ECONOMY.rareEnabled,
  chance: number = ECONOMY.rareChance,
): Uint8Array {
  const rare = new Uint8Array(count);
  if (!enabled) return rare;
  const rng = createRng((seed ^ ECONOMY.rareSalt) >>> 0);
  for (let i = 0; i < count; i++) {
    const roll = rng(); // 자격과 무관하게 매번 뽑아 조각 번호마다 결과가 고정되게
    if (eligible(i) && roll < chance) rare[i] = 1;
  }
  return rare;
}
