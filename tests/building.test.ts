import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILDING, generateBuilding } from '../src/building/BuildingGenerator';
import { boxVolume, type Member } from '../src/building/Member';
import { allocateSeeds, memberSeeds, seedCountsForPreset } from '../src/building/seedBudget';
import { QUALITY_PRESETS, type QualityPreset } from '../src/config';
import { convexIntersectionArea, findBoxContacts } from '../src/fracture/contacts';
import { MATERIAL, type Fragment } from '../src/fracture/Fragment';
import { runFracture } from '../src/fracture/pipeline';
import { createRng } from '../src/fracture/seeds';

const building = generateBuilding();

function overlapVolume(a: Member, b: Member): number {
  const dx = Math.min(a.box.max.x, b.box.max.x) - Math.max(a.box.min.x, b.box.min.x);
  const dy = Math.min(a.box.max.y, b.box.max.y) - Math.max(a.box.min.y, b.box.min.y);
  const dz = Math.min(a.box.max.z, b.box.max.z) - Math.max(a.box.min.z, b.box.min.z);
  return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

describe('generateBuilding', () => {
  const { members } = building;
  const { floors, baysX, baysZ } = DEFAULT_BUILDING;
  const count = (kind: Member['kind']) => members.filter((m) => m.kind === kind).length;

  it('members never overlap', () => {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        expect(overlapVolume(members[i]!, members[j]!)).toBeLessThan(1e-9);
      }
    }
  });

  it('only the foundation is anchored, and every member is a positive box', () => {
    for (const m of members) {
      expect(m.anchor).toBe(m.kind === 'foundation');
      expect(boxVolume(m.box)).toBeGreaterThan(0);
    }
    expect(count('foundation')).toBe(1);
  });

  it('member counts follow floors and bays', () => {
    const perimeterBays = 2 * (baysX + baysZ);
    expect(count('column')).toBe(floors * (baysX + 1) * (baysZ + 1));
    expect(count('slab')).toBe(floors);
    expect(count('beam')).toBe(floors * ((baysZ + 1) * baysX + (baysX + 1) * baysZ));
    expect(count('wallPanel')).toBe(floors * perimeterBays * 4);
    expect(count('glass')).toBe(floors * perimeterBays);
    expect(count('parapet')).toBe(4);
  });

  it('without windows each bay is a single solid panel', () => {
    const solid = generateBuilding({ ...DEFAULT_BUILDING, windowRatio: 0 }).members;
    expect(solid.filter((m) => m.kind === 'glass')).toHaveLength(0);
    expect(solid.filter((m) => m.kind === 'wallPanel')).toHaveLength(floors * 2 * (baysX + baysZ));
  });

  it('every member touches something (no floating parts)', () => {
    const touched = new Set<number>();
    for (const c of findBoxContacts(members.map((m) => m.box))) {
      touched.add(c.lo);
      touched.add(c.hi);
    }
    expect(touched.size).toBe(members.length);
  });
});

describe('seed budget', () => {
  it.each(Object.keys(QUALITY_PRESETS) as QualityPreset[])(
    '%s preset hits its target',
    (preset) => {
      const total = seedCountsForPreset(building.members, preset).reduce((s, n) => s + n, 0);
      const target = QUALITY_PRESETS[preset].targetFragments;
      expect(Math.abs(total - target) / target).toBeLessThan(0.1);
    },
  );

  it('wall panels are cut finer than slabs, slabs finer than columns', () => {
    const counts = seedCountsForPreset(building.members, 'medium');
    const avgPieceVolume = (kind: Member['kind']) => {
      let volume = 0;
      let pieces = 0;
      building.members.forEach((m, i) => {
        if (m.kind !== kind) return;
        volume += boxVolume(m.box);
        pieces += counts[i]!;
      });
      return volume / pieces;
    };
    expect(avgPieceVolume('wallPanel')).toBeLessThan(avgPieceVolume('slab'));
    expect(avgPieceVolume('slab')).toBeLessThan(avgPieceVolume('column'));
  });

  it('every member gets at least one seed even below the member count', () => {
    expect(allocateSeeds(building.members, 10).every((n) => n === 1)).toBe(true);
  });

  it('jittered member seeds stay close to the requested count on thin plates', () => {
    const glass = building.members.find((m) => m.kind === 'glass')!;
    const n = memberSeeds(glass, 20, createRng(1)).length / 3;
    expect(n).toBeGreaterThanOrEqual(15);
    expect(n).toBeLessThanOrEqual(25);
  });
});

describe('convexIntersectionArea', () => {
  it('computes overlap of two unit squares offset by half', () => {
    const a = [0, 0, 1, 0, 1, 1, 0, 1];
    const b = [0.5, 0.5, 1.5, 0.5, 1.5, 1.5, 0.5, 1.5];
    expect(convexIntersectionArea(a, b)).toBeCloseTo(0.25, 12);
    expect(convexIntersectionArea(a, [2, 2, 3, 2, 3, 3, 2, 3])).toBe(0);
  });
});

describe('runFracture across members', () => {
  it('two stacked boxes connect across their contact face with its full area', () => {
    const rng = createRng(3);
    const lower = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 1, z: 2 } };
    const upper = { min: { x: 0.5, y: 1, z: 0.5 }, max: { x: 1.5, y: 2, z: 1.5 } };
    const frags = runFracture({
      jobs: [
        { box: lower, seeds: memberSeeds({ kind: 'slab', box: lower, anchor: true }, 30, rng) },
        { box: upper, seeds: memberSeeds({ kind: 'column', box: upper, anchor: false }, 10, rng) },
      ],
    });
    let crossArea = 0;
    frags.forEach((f, i) => {
      f.neighbors.forEach((j, k) => {
        const back = frags[j]!;
        const idx = Array.from(back.neighbors).indexOf(i);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(back.neighborAreas[idx]).toBeCloseTo(f.neighborAreas[k]!, 5);
        if (f.member === 0 && back.member === 1) crossArea += f.neighborAreas[k]!;
      });
    });
    expect(crossArea).toBeCloseTo(1, 5); // 1 × 1 접촉면
  });

  describe('small building (2 floors)', () => {
    const small = generateBuilding({ ...DEFAULT_BUILDING, floors: 2, baysX: 2, baysZ: 2 });
    const counts = allocateSeeds(small.members, 600);
    const rng = createRng(11);
    const frags: Fragment[] = runFracture({
      jobs: small.members.map((m, i) => ({
        box: m.box,
        seeds: memberSeeds(m, counts[i]!, rng),
        material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
      })),
    });

    it('preserves each member volume', () => {
      const volumes = new Float64Array(small.members.length);
      for (const f of frags) volumes[f.member]! += f.volume;
      small.members.forEach((m, i) => {
        expect(Math.abs(volumes[i]! - boxVolume(m.box)) / boxVolume(m.box)).toBeLessThan(0.01);
      });
    });

    it('tags glass fragments with the glass material', () => {
      for (const f of frags) {
        expect(f.material === MATERIAL.glass).toBe(small.members[f.member]!.kind === 'glass');
      }
    });

    it('every fragment is reachable from the foundation through neighbors', () => {
      const seen = new Uint8Array(frags.length);
      const queue: number[] = [];
      frags.forEach((f, i) => {
        if (small.members[f.member]!.anchor) {
          seen[i] = 1;
          queue.push(i);
        }
      });
      while (queue.length > 0) {
        const i = queue.pop()!;
        for (const j of frags[i]!.neighbors) {
          if (!seen[j]) {
            seen[j] = 1;
            queue.push(j);
          }
        }
      }
      expect(seen.every((s) => s === 1)).toBe(true);
    });
  });
});
