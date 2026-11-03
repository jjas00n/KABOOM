import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/building/BuildingGenerator';
import { seedCountsForPreset, targetFragments } from '../src/building/seedBudget';
import { BUILDING, ORDERS, QUALITY_PRESETS, type QualityPreset } from '../src/config';
import { Career } from '../src/orders/Career';
import { ALL_TIERS, ALL_TRAITS } from '../src/orders/Order';
import { generateBoard } from '../src/orders/OrderGenerator';
import { unlockedTiersFor } from '../src/orders/unlock';
import { buildArchetype, TINY_ARCHETYPES } from '../src/building/archetypes';

const QUALITIES = Object.keys(QUALITY_PRESETS) as QualityPreset[];

describe('OrderGenerator', () => {
  it('is deterministic: same seed → same cards, different seed → different cards', () => {
    expect(generateBoard(42)).toEqual(generateBoard(42));
    expect(generateBoard(7)).toEqual(generateBoard(7));
    const a = generateBoard(42).map((o) => o.building.seed);
    const b = generateBoard(43).map((o) => o.building.seed);
    expect(a).not.toEqual(b);
  });

  it('deals 3 cards, one per tier when all tiers are unlocked, each with a distinct trait', () => {
    for (let seed = 0; seed < 12; seed++) {
      const board = generateBoard(seed);
      expect(board).toHaveLength(ORDERS.cardsPerBoard);
      expect(new Set(board.map((o) => o.tier))).toEqual(new Set(ALL_TIERS));
      expect(new Set(board.map((o) => o.trait)).size).toBe(board.length);
      for (const o of board) expect(ALL_TRAITS).toContain(o.trait);
      expect(new Set(board.map((o) => o.id)).size).toBe(board.length);
    }
  });

  it('only deals unlocked tiers (Phase 10 unlock hook)', () => {
    for (let seed = 0; seed < 8; seed++) {
      expect(
        generateBoard(seed, { unlockedTiers: ['small'] }).every((o) => o.tier === 'small'),
      ).toBe(true);
      const two = generateBoard(seed, { unlockedTiers: ['small', 'medium'] });
      expect(two.every((o) => o.tier !== 'large')).toBe(true);
      expect(new Set(two.map((o) => o.tier)).size).toBe(2);
    }
  });

  it('keeps building parameters within limits and names non-empty', () => {
    const { limits } = BUILDING;
    for (let seed = 0; seed < 12; seed++) {
      for (const o of generateBoard(seed)) {
        const b = o.building;
        expect(b.floors).toBeGreaterThanOrEqual(limits.floors[0]);
        expect(b.floors).toBeLessThanOrEqual(limits.floors[1]);
        for (const bays of [b.baysX, b.baysZ]) {
          expect(Number.isInteger(bays)).toBe(true);
          expect(bays).toBeGreaterThanOrEqual(limits.bays[0]);
          expect(bays).toBeLessThanOrEqual(limits.bays[1]);
        }
        expect(b.baysZ).toBeLessThanOrEqual(ORDERS.maxBaysZ);
        expect(b.windowRatio).toBeGreaterThanOrEqual(limits.windowRatio[0]);
        expect(b.windowRatio).toBeLessThanOrEqual(limits.windowRatio[1]);
        expect(b.seed).toBeGreaterThan(0);
        expect(o.name.trim()).not.toBe('');
        expect(o.client.trim()).not.toBe('');
        expect(o.rewardMultiplier).toBeGreaterThan(0);
        expect(o.completionBonus).toBeGreaterThan(0);
      }
    }
  });

  it('traits shape the order the way the card says', () => {
    const all = Array.from({ length: 12 }, (_, s) => generateBoard(s)).flat();
    for (const o of all) {
      const t = ORDERS.tiers[o.tier];
      if (o.trait === 'glassy') {
        expect(o.building.windowRatio).toBe(ORDERS.glassy.windowRatio);
        expect(o.priceScale.glass).toBe(ORDERS.glassy.glassPriceScale);
      }
      if (o.trait === 'slender')
        expect(Math.max(o.building.baysX, o.building.baysZ)).toBeLessThanOrEqual(2);
      if (o.trait === 'sprawling') {
        expect(o.building.floors).toBeLessThan(t.floors[0]);
        expect(o.budgetScale).toBeGreaterThan(t.budgetScale);
      }
      if (o.trait === 'reinforced') {
        expect(o.building.durabilityBonus).toBe(ORDERS.reinforced.durabilityBonus);
        expect(o.rewardMultiplier).toBeGreaterThan(t.rewardMultiplier);
      } else {
        expect(o.building.durabilityBonus).toBe(0);
      }
    }
  });

  it('estimated fragments match the seed budget and stay under the cap', () => {
    for (const o of generateBoard(5)) {
      const { members } = generateBuilding(o.building);
      for (const q of QUALITIES) {
        const sum = seedCountsForPreset(members, q, o.budgetScale).reduce((a, n) => a + n, 0);
        expect(o.estimatedFragments[q]).toBe(sum);
        expect(o.estimatedPayout[q]).toBeGreaterThan(0);
      }
      expect(o.estimatedFragments.low).toBeLessThan(o.estimatedFragments.high);
    }
    expect(targetFragments('high', 10)).toBe(ORDERS.maxFragments);
  });

  it('bigger tiers pay more in total', () => {
    for (let seed = 0; seed < 8; seed++) {
      const byTier = Object.fromEntries(
        generateBoard(seed, { unlockedTiers: ALL_TIERS })
          .filter((o) => o.trait !== 'sprawling' && o.trait !== 'slender')
          .map((o) => [o.tier, o.estimatedPayout.medium]),
      );
      if (byTier.small !== undefined && byTier.large !== undefined) {
        expect(byTier.large).toBeGreaterThan(byTier.small);
      }
    }
  });
});

describe('Career', () => {
  it('counts demolished buildings, abandoned orders, fragments and the best building', () => {
    const c = new Career();
    c.recordCompleted('A', 500, 100);
    c.recordAbandoned(30);
    c.recordCompleted('B', 900, 200);
    c.recordCompleted('C', 700, 150);
    expect(c.data).toEqual({
      buildingsDemolished: 3,
      ordersAbandoned: 1,
      totalFragments: 480,
      best: { name: 'B', total: 900 },
      starterComplete: false,
    });
  });
});

describe('starter (tiny) orders and the tutorial gate', () => {
  it('a new career only sees tiny orders until N buildings are demolished', () => {
    const c = new Career();
    for (let k = 0; k < ORDERS.tutorialBuildings; k++) {
      expect(unlockedTiersFor(c.data)).toEqual(['tiny']);
      for (let seed = 0; seed < 6; seed++) {
        const board = generateBoard(seed * 31 + k, { unlockedTiers: unlockedTiersFor(c.data) });
        expect(board.every((o) => o.tier === 'tiny')).toBe(true);
      }
      c.recordCompleted(`T${k}`, 50, 300);
    }
    expect(unlockedTiersFor(c.data)).toEqual(ALL_TIERS);
    const board = generateBoard(5, { unlockedTiers: unlockedTiersFor(c.data) });
    expect(board.some((o) => o.tier === 'tiny')).toBe(false);
    // 7-4 이전 세이브 (starterComplete) 는 바로 office
    expect(unlockedTiersFor({ buildingsDemolished: 0, starterComplete: true })).toEqual(ALL_TIERS);
    // 포기한 의뢰는 게이트를 넘기지 않는다
    const d = new Career();
    d.recordAbandoned(100);
    expect(unlockedTiersFor(d.data)).toEqual(['tiny']);
  });

  it('tiny cards are deterministic, use tiny archetypes, small budgets and fictional names', () => {
    const tiny = { unlockedTiers: ['tiny'] as const };
    expect(generateBoard(9, tiny)).toEqual(generateBoard(9, tiny));
    const seen = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      for (const o of generateBoard(seed, tiny)) {
        seen.add(o.archetype);
        expect(TINY_ARCHETYPES).toContain(o.archetype);
        expect(o.building.archetype).toBe(o.archetype);
        expect(o.trait).toBe('starter');
        expect(o.fragmentCap).toBe(ORDERS.tinyMaxFragments);
        // 부재별 반올림으로 목표보다 몇 개 많을 수 있다
        expect(o.estimatedFragments.high).toBeLessThanOrEqual(ORDERS.tinyMaxFragments * 1.05);
        expect(o.estimatedFragments.low).toBeGreaterThanOrEqual(100);
        expect(ORDERS.tinyNames[o.archetype]).toContain(o.name);
        expect(ORDERS.tinyClients).toContain(o.client);
        expect(o.completionBonus).toBe(ORDERS.tiers.tiny.completionBonus);
        expect(new Set(generateBoard(seed, tiny).map((x) => x.archetype)).size).toBe(3);
        const sum = seedCountsForPreset(
          buildArchetype(o.building).members,
          'medium',
          o.budgetScale,
          o.fragmentCap,
        ).reduce((a, n) => a + n, 0);
        expect(o.estimatedFragments.medium).toBe(sum);
      }
    }
    expect(seen).toEqual(new Set(TINY_ARCHETYPES));
  });

  it('a tiny order pays a small fraction of a small order', () => {
    const small = generateBoard(3, { unlockedTiers: ['small'] }).filter(
      (o) => o.trait !== 'sprawling' && o.trait !== 'slender',
    );
    const tiny = generateBoard(3, { unlockedTiers: ['tiny'] });
    const avg = (os: typeof tiny) =>
      os.reduce((a, o) => a + o.estimatedPayout.medium, 0) / os.length;
    expect(avg(tiny)).toBeLessThan(avg(small) / 3);
  });
});
