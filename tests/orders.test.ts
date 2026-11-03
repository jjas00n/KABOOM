import { describe, expect, it } from 'vitest';
import { generateBuilding } from '../src/building/BuildingGenerator';
import { seedCountsForPreset, targetFragments } from '../src/building/seedBudget';
import { BUILDING, ORDERS, QUALITY_PRESETS, type QualityPreset } from '../src/config';
import { Career } from '../src/orders/Career';
import { ALL_TIERS, ALL_TRAITS } from '../src/orders/Order';
import { generateBoard } from '../src/orders/OrderGenerator';

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
    });
  });
});
