// 주문 게시판 생성 (순수 로직): 게시판 seed 하나로 카드 3장. 같은 seed면 항상 같은 카드다.
//   - 등급(소/중/대) = 규모·조각 예산·보상 배율·완료 보너스. 크면 총액이 크지만 시간당 효율은 낮다
//   - 특징(유리 많음/고층 슬림/저층 넓음/보강) = 모양과 보상을 바꿔 고르는 데 전략이 생기게
//   - unlockedTiers: 열린 등급만 나온다 (Phase 10 등급 해금 자리). 다 열려 있으면 등급마다 한 장
//   - tiny(입문, 7-4): 아키타입(크리스털 동상/벽돌 오두막/나무 헛간/모래성)이 특징. 이름·의뢰인도 입문용
import { buildArchetype, TINY_ARCHETYPES } from '../building/archetypes';
import { DEFAULT_BUILDING } from '../building/BuildingGenerator';
import { memberVolume } from '../building/Member';
import { seedCountsForPreset } from '../building/seedBudget';
import {
  BUILDING,
  ECONOMY,
  MATERIALS,
  ORDERS,
  QUALITY_PRESETS,
  type QualityPreset,
} from '../config';
import { fragmentValue, type PriceScale } from '../economy/FragmentValue';
import { createRng, type Rng } from '../fracture/seeds';
import { ALL_TIERS, ALL_TRAITS, type Order, type OrderTier, type OrderTrait } from './Order';

/** 게시판 seed와 섞는 값 (건물 seed와 다른 난수열) */
const BOARD_SALT = 0x5eed0b0a;
const QUALITIES = Object.keys(QUALITY_PRESETS) as QualityPreset[];

export interface BoardOptions {
  /** 열린 등급 (기본: 전부) */
  unlockedTiers?: readonly OrderTier[];
}

export function generateBoard(boardSeed: number, options: BoardOptions = {}): Order[] {
  const unlocked = options.unlockedTiers?.length ? options.unlockedTiers : ALL_TIERS;
  const rng = createRng((boardSeed ^ BOARD_SALT) >>> 0);
  const n = ORDERS.cardsPerBoard;
  const tiers = pickTiers(unlocked, n, rng);
  const traits = shuffle([...ALL_TRAITS], rng);
  const clients = shuffle([...ORDERS.clients], rng);
  const prefixes = shuffle([...ORDERS.buildingPrefixes], rng);
  const orders: Order[] = [];
  for (let i = 0; i < n; i++) {
    const tier = tiers[i]!;
    if (tier === 'tiny') {
      orders.push(makeTinyOrder(rng, `${boardSeed}-${i}`, clients, i));
      continue;
    }
    const suffixes = ORDERS.buildingSuffixes[tier];
    const suffix = suffixes[Math.floor(rng() * suffixes.length)]!;
    orders.push(
      makeOrder(rng, {
        id: `${boardSeed}-${i}`,
        name: `${prefixes[i % prefixes.length]} ${suffix}`,
        client: clients[i % clients.length]!,
        tier,
        trait: traits[i % traits.length]!,
      }),
    );
  }
  return orders;
}

/** 등급 n개: 열린 등급을 한 번씩 (섞어서), 모자라면 열린 등급 중에서 뽑아 채운다 */
function pickTiers(unlocked: readonly OrderTier[], n: number, rng: Rng): OrderTier[] {
  const tiers = shuffle([...unlocked], rng).slice(0, n);
  while (tiers.length < n) tiers.push(unlocked[Math.floor(rng() * unlocked.length)]!);
  return tiers;
}

/** 입문 주문: 아키타입 하나를 골라 이름·의뢰인을 붙인다. 보상은 등급 값 그대로 */
function makeTinyOrder(rng: Rng, id: string, _clients: readonly string[], index: number): Order {
  const t = ORDERS.tiers.tiny;
  const archetype = TINY_ARCHETYPES[Math.floor(rng() * TINY_ARCHETYPES.length)]!;
  const names = ORDERS.tinyNames[archetype]!;
  const name = names[Math.floor(rng() * names.length)]!;
  const clients = ORDERS.tinyClients;
  const client = clients[(index + Math.floor(rng() * clients.length)) % clients.length]!;
  const seed = 1 + Math.floor(rng() * 0x7ffffffe);
  const order: Order = {
    id,
    name,
    client,
    tier: 'tiny',
    trait: 'starter',
    archetype,
    building: { ...DEFAULT_BUILDING, archetype, seed },
    budgetScale: t.budgetScale,
    fragmentCap: ORDERS.tinyMaxFragments,
    rewardMultiplier: t.rewardMultiplier,
    completionBonus: t.completionBonus,
    priceScale: {},
    estimatedFragments: { low: 0, medium: 0, high: 0 },
    estimatedPayout: { low: 0, medium: 0, high: 0 },
  };
  estimate(order);
  return order;
}

interface Identity {
  id: string;
  name: string;
  client: string;
  tier: OrderTier;
  trait: OrderTrait;
}

function makeOrder(rng: Rng, who: Identity): Order {
  const t = ORDERS.tiers[who.tier];
  let floors = intIn(rng, t.floors);
  let baysX = intIn(rng, t.baysX);
  let baysZ = intIn(rng, t.baysZ);
  let windowRatio = round2(
    ORDERS.windowRatio[0] + rng() * (ORDERS.windowRatio[1] - ORDERS.windowRatio[0]),
  );
  const seed = 1 + Math.floor(rng() * 0x7ffffffe);
  let budgetScale: number = t.budgetScale;
  let reward: number = t.rewardMultiplier;
  let durabilityBonus = 0;
  let priceScale: PriceScale = {};

  switch (who.trait) {
    case 'glassy':
      windowRatio = ORDERS.glassy.windowRatio;
      priceScale = { glass: ORDERS.glassy.glassPriceScale };
      break;
    case 'slender':
      baysX = intIn(rng, ORDERS.slender.bays);
      baysZ = intIn(rng, ORDERS.slender.bays);
      floors = t.floors[1] + ORDERS.slender.extraFloors;
      reward *= ORDERS.slender.rewardScale;
      break;
    case 'sprawling':
      floors = Math.max(1, Math.ceil(t.floors[0] / 2));
      baysX = t.baysX[1] + ORDERS.sprawling.extraBaysX;
      baysZ = t.baysZ[1] + ORDERS.sprawling.extraBaysZ;
      budgetScale *= ORDERS.sprawling.budgetScale;
      break;
    case 'reinforced':
      durabilityBonus = ORDERS.reinforced.durabilityBonus;
      reward *= ORDERS.reinforced.rewardScale;
      break;
  }

  const { limits } = BUILDING;
  const building = {
    ...DEFAULT_BUILDING,
    floors: clamp(floors, limits.floors),
    baysX: clamp(baysX, limits.bays),
    baysZ: Math.min(clamp(baysZ, limits.bays), ORDERS.maxBaysZ),
    windowRatio: clamp(windowRatio, limits.windowRatio),
    seed,
    durabilityBonus,
  };
  const rewardMultiplier = round2(reward);
  const order: Order = {
    ...who,
    archetype: 'office',
    building,
    budgetScale: round2(budgetScale),
    fragmentCap: ORDERS.maxFragments,
    rewardMultiplier,
    completionBonus: t.completionBonus,
    priceScale,
    estimatedFragments: { low: 0, medium: 0, high: 0 },
    estimatedPayout: { low: 0, medium: 0, high: 0 },
  };
  estimate(order);
  return order;
}

/**
 * 예상 조각 수와 수익: 부재마다 시드 수만큼 같은 크기 조각으로 나뉜다고 보고 조각 가치를 더한다
 * (내구도 가치·희귀 제외 근사). 완파하면 전부 지급 + 완료 보너스.
 */
function estimate(order: Order): void {
  const { members } = buildArchetype(order.building);
  for (const q of QUALITIES) {
    const counts = seedCountsForPreset(members, q, order.budgetScale, order.fragmentCap);
    let fragments = 0;
    let value = 0;
    members.forEach((m, i) => {
      const n = counts[i]!;
      const mass = (memberVolume(m) * MATERIALS[m.material].density) / n;
      fragments += n;
      value += n * fragmentValue(mass, m.kind, m.material, 1, false, ECONOMY, order.priceScale);
    });
    order.estimatedFragments[q] = fragments;
    order.estimatedPayout[q] = Math.round(
      value * order.rewardMultiplier * (1 + order.completionBonus),
    );
  }
}

function intIn(rng: Rng, [lo, hi]: readonly [number, number]): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function clamp(v: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(Math.max(v, lo), hi);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Fisher–Yates (제자리) */
function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
