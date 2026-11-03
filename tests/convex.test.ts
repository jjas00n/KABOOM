// Phase 7-4 볼록 부재: 박스를 반공간으로 자른 부재의 분할(부피 보존), 시드(모양 안), 부재 간 평면 접촉.
import { describe, expect, it } from 'vitest';
import { box, memberPolyhedron, memberVolume, type Member } from '../src/building/Member';
import { memberSeeds } from '../src/building/seedBudget';
import { boxMember, gable, ngonColumn, slopedSlab, taperedColumn } from '../src/building/shapes';
import { runFracture } from '../src/fracture/pipeline';
import { containsPoint, volumeAndCentroid } from '../src/fracture/polyhedron';
import { createRng } from '../src/fracture/seeds';

const job = (m: Member, n: number, seed = 3) => ({
  box: m.box,
  planes: m.planes,
  grain: m.grain,
  seeds: memberSeeds(m, n, createRng(seed)),
});

/** 조각 사이 엣지 면적 합 (부재 a ↔ 부재 b) */
function crossArea(frags: ReturnType<typeof runFracture>, a: number, b: number): number {
  let sum = 0;
  for (const f of frags) {
    if (f.member !== a) continue;
    f.neighbors.forEach((j, k) => {
      if (frags[j]!.member === b) sum += f.neighborAreas[k]!;
    });
  }
  return sum;
}

describe('convex members', () => {
  const shapes: [string, Member][] = [
    ['octagonal column', ngonColumn('column', 'stone', 0, 0, 0.5, 0, 2, 8)],
    ['dodecagon tower', ngonColumn('column', 'sand', 1, -2, 0.7, 0.2, 1.4, 12)],
    ['tapered torso', taperedColumn('column', 'crystal', 0, 0, 1, 2, [0.4, 0.3], [0.25, 0.2])],
    ['gable roof', gable('slab', 'brick', box(-1, 2, -1.5, 1, 3, 1.5), 'x')],
    ['sloped plank', slopedSlab('slab', 'wood', -1, 1, -1, 1, 2, 2.6, 0.06)],
    [
      'grained sloped plank',
      slopedSlab('slab', 'wood', -1, 1, -1, 1, 2, 2.6, 0.06, { grain: { axis: 0, stretch: 4 } }),
    ],
    [
      'grained box plank',
      boxMember('wallPanel', 'wood', box(0, 0, 0, 2, 0.2, 0.03), {
        grain: { axis: 0, stretch: 5 },
      }),
    ],
  ];

  it.each(shapes)('%s: cells exactly fill the shape (volume preserved)', (_name, m) => {
    const expected = memberVolume(m);
    expect(expected).toBeGreaterThan(0);
    const frags = runFracture({ jobs: [job(m, 40)] });
    expect(frags.length).toBeGreaterThan(10);
    const sum = frags.reduce((s, f) => s + f.volume, 0);
    expect(Math.abs(sum - expected) / expected).toBeLessThan(1e-6);
  });

  it.each(shapes)('%s: seeds lie inside the shape', (_name, m) => {
    const poly = memberPolyhedron(m);
    const seeds = memberSeeds(m, 60, createRng(9));
    expect(seeds.length / 3).toBeGreaterThan(30);
    for (let k = 0; k < seeds.length; k += 3) {
      expect(containsPoint(poly, seeds[k]!, seeds[k + 1]!, seeds[k + 2]!)).toBe(true);
    }
  });

  it('known volumes: octagon prism and triangular gable', () => {
    const oct = ngonColumn('column', 'stone', 0, 0, 0.5, 0, 2, 8);
    // 정n각형 넓이 = n · a² · tan(π/n)
    expect(memberVolume(oct)).toBeCloseTo(8 * 0.25 * Math.tan(Math.PI / 8) * 2, 9);
    const g = gable('slab', 'brick', box(-1, 2, -1.5, 1, 3, 1.5), 'x');
    expect(memberVolume(g)).toBeCloseTo(0.5 * 3 * 1 * 2, 9);
  });

  it('octagonal column on a box plinth: contact area = octagon area', () => {
    const plinth = boxMember('foundation', 'stone', box(-1, -0.2, -1, 1, 0, 1), { anchor: true });
    const col = ngonColumn('column', 'stone', 0, 0, 0.5, 0, 2, 8);
    const frags = runFracture({ jobs: [job(plinth, 12, 1), job(col, 30, 2)] });
    const octagon = 8 * 0.25 * Math.tan(Math.PI / 8);
    expect(crossArea(frags, 0, 1)).toBeCloseTo(octagon, 6);
    expect(crossArea(frags, 1, 0)).toBeCloseTo(octagon, 6);
  });

  it('wall against a flat face of a 12-gon tower (vertical contact)', () => {
    const a = 0.8;
    const tower = ngonColumn('column', 'sand', 0, 0, a, 0, 2, 12);
    // 탑의 +x 면에 붙는 벽: 높이 1.5, 두께 0.4 (탑 면 폭 = 2·a·tan(π/12) > 0.4)
    const wall = boxMember('wallPanel', 'sand', box(a, 0, -0.2, a + 2, 1.5, 0.2));
    const frags = runFracture({ jobs: [job(tower, 30, 4), job(wall, 20, 5)] });
    expect(crossArea(frags, 0, 1)).toBeCloseTo(1.5 * 0.4, 6);
  });

  it('tapered torso between two boxes: top and bottom faces connect', () => {
    const below = boxMember('column', 'crystal', box(-0.4, 0, -0.3, 0.4, 1, 0.3));
    const torso = taperedColumn('column', 'crystal', 0, 0, 1, 2, [0.4, 0.3], [0.25, 0.2]);
    const above = boxMember('column', 'crystal', box(-0.25, 2, -0.2, 0.25, 2.3, 0.2));
    const frags = runFracture({ jobs: [job(below, 15, 1), job(torso, 30, 2), job(above, 8, 3)] });
    expect(crossArea(frags, 0, 1)).toBeCloseTo(0.8 * 0.6, 6);
    expect(crossArea(frags, 1, 2)).toBeCloseTo(0.5 * 0.4, 6);
  });

  it('gable on two walls: sloped faces do not connect, the base does', () => {
    const left = boxMember('wallPanel', 'brick', box(-1, 0, -1.5, 1, 2, -1.2));
    const right = boxMember('wallPanel', 'brick', box(-1, 0, 1.2, 1, 2, 1.5));
    const roof = gable('slab', 'brick', box(-1, 2, -1.5, 1, 3, 1.5), 'x');
    const frags = runFracture({ jobs: [job(left, 10, 1), job(right, 10, 2), job(roof, 30, 3)] });
    expect(crossArea(frags, 0, 2)).toBeCloseTo(2 * 0.3, 6);
    expect(crossArea(frags, 1, 2)).toBeCloseTo(2 * 0.3, 6);
  });

  it('box-only jobs are unaffected by the convex path (same neighbors as before)', () => {
    const a = boxMember('slab', 'concrete', box(0, 0, 0, 2, 0.3, 2));
    const b = boxMember('column', 'concrete', box(0.5, 0.3, 0.5, 1, 2, 1));
    const frags = runFracture({ jobs: [job(a, 20, 1), job(b, 10, 2)] });
    expect(crossArea(frags, 0, 1)).toBeCloseTo(0.25, 6);
  });

  it('grain stretches cells along the grain axis', () => {
    const plank = boxMember('wallPanel', 'wood', box(0, 0, 0, 2, 0.2, 0.03), {
      grain: { axis: 0, stretch: 4 },
    });
    const plain = boxMember('wallPanel', 'wood', box(0, 0, 0, 2, 0.2, 0.03));
    /** 조각의 x(결 방향) 길이 평균 */
    const lengthAlongGrain = (m: Member) => {
      const frags = runFracture({ jobs: [job(m, 12, 7)] });
      let sum = 0;
      for (const f of frags) {
        let x0 = Infinity;
        let x1 = -Infinity;
        for (let k = 0; k < f.hull.length; k += 3) {
          x0 = Math.min(x0, f.hull[k]!);
          x1 = Math.max(x1, f.hull[k]!);
        }
        sum += x1 - x0;
      }
      return sum / frags.length;
    };
    expect(lengthAlongGrain(plank)).toBeGreaterThan(lengthAlongGrain(plain) * 1.5);
  });

  it('volumeAndCentroid of a clipped box matches memberVolume', () => {
    const m = ngonColumn('column', 'stone', 0, 0, 0.5, 0, 2, 10);
    expect(volumeAndCentroid(memberPolyhedron(m)).volume).toBeCloseTo(memberVolume(m), 12);
  });
});
