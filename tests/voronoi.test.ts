import { describe, expect, it } from 'vitest';
import {
  buildFragments,
  packFragments,
  unpackFragments,
  type Fragment,
} from '../src/fracture/Fragment';
import { boxPolyhedron, EXTERIOR, polygonArea } from '../src/fracture/polyhedron';
import { adaptiveSeeds, createRng, jitteredGridSeeds, uniformSeeds } from '../src/fracture/seeds';
import { voronoiCells } from '../src/fracture/voronoi';

const BOX = { min: { x: -2, y: 0, z: -1 }, max: { x: 2, y: 3, z: 1 } };
const BOX_VOLUME = 4 * 3 * 2;
const BOX_AREA = 2 * (4 * 3 + 4 * 2 + 3 * 2);

function fracture(seeds: Float64Array) {
  const cells = voronoiCells(boxPolyhedron(BOX.min, BOX.max), seeds);
  return { cells, frags: buildFragments(cells) };
}

const SEED_SETS = {
  uniform: uniformSeeds(BOX, 300, createRng(1)),
  jittered: jitteredGridSeeds(BOX, 300, createRng(2)),
  adaptive: adaptiveSeeds(BOX, 300, { x: 1, y: 2, z: 1 }, createRng(3), 1.5, 6),
};

/** 삼각형 평면 기준으로 모든 hull 점이 안쪽(또는 평면 위)에 있는지 */
function isConvex(f: Fragment, tol = 1e-4): boolean {
  const p = f.positions;
  for (let t = 0; t < f.indices.length; t += 3) {
    const a = f.indices[t]! * 3;
    const b = f.indices[t + 1]! * 3;
    const c = f.indices[t + 2]! * 3;
    const ux = p[b]! - p[a]!,
      uy = p[b + 1]! - p[a + 1]!,
      uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!,
      vy = p[c + 1]! - p[a + 1]!,
      vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue; // 퇴화 삼각형은 판정 불가
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = 0; k < f.hull.length; k += 3) {
      const d =
        (f.hull[k]! - p[a]!) * nx +
        (f.hull[k + 1]! - p[a + 1]!) * ny +
        (f.hull[k + 2]! - p[a + 2]!) * nz;
      if (d > tol) return false;
    }
  }
  return true;
}

describe.each(Object.entries(SEED_SETS))('voronoiCells (%s seeds)', (_name, seeds) => {
  const { cells, frags } = fracture(seeds);

  it('keeps every seed as one cell', () => {
    expect(cells.length).toBe(seeds.length / 3);
  });

  it('fragment volumes sum to the original volume (within 1%)', () => {
    const total = frags.reduce((s, f) => s + f.volume, 0);
    expect(Math.abs(total - BOX_VOLUME) / BOX_VOLUME).toBeLessThan(0.01);
    for (const f of frags) expect(f.volume).toBeGreaterThan(0);
  });

  it('every fragment is convex with outward-facing triangles', () => {
    for (const f of frags) expect(isConvex(f)).toBe(true);
  });

  it('neighbor relation is symmetric with matching shared area', () => {
    cells.forEach((cell, i) => {
      for (const [j, area] of cell.neighbors) {
        expect(j).not.toBe(i);
        const back = cells[j]!.neighbors.get(i);
        expect(back).toBeDefined();
        expect(Math.abs(back! - area)).toBeLessThan(1e-6 + 1e-4 * area);
      }
    });
  });

  it('exterior faces cover exactly the original surface', () => {
    let exterior = 0;
    for (const cell of cells) {
      for (const f of cell.poly.faces) {
        if (f.neighbor === EXTERIOR) exterior += polygonArea(f.verts, f.nx, f.ny, f.nz);
      }
    }
    expect(exterior).toBeCloseTo(BOX_AREA, 6);
  });

  it('volume-weighted centroids average to the box center', () => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const f of frags) {
      cx += f.centroid.x * f.volume;
      cy += f.centroid.y * f.volume;
      cz += f.centroid.z * f.volume;
    }
    expect(cx / BOX_VOLUME).toBeCloseTo(0, 6);
    expect(cy / BOX_VOLUME).toBeCloseTo(1.5, 6);
    expect(cz / BOX_VOLUME).toBeCloseTo(0, 6);
  });
});

describe('voronoiCells edge cases', () => {
  it('a single seed returns the whole box with only exterior faces', () => {
    const { cells, frags } = fracture(new Float64Array([0.3, 1, 0.2]));
    expect(cells).toHaveLength(1);
    expect(frags[0]!.volume).toBeCloseTo(BOX_VOLUME, 9);
    expect(frags[0]!.exteriorIndexCount).toBe(frags[0]!.indices.length);
    expect(cells[0]!.neighbors.size).toBe(0);
  });

  it('two seeds split along their bisector and share its full area', () => {
    const { cells } = fracture(new Float64Array([-1, 1.5, 0, 1, 1.5, 0]));
    expect(cells).toHaveLength(2);
    expect(cells[0]!.volume).toBeCloseTo(BOX_VOLUME / 2, 9);
    expect(cells[0]!.neighbors.get(1)).toBeCloseTo(3 * 2, 9);
  });

  it('ignores seeds outside the domain and duplicates', () => {
    const { cells } = fracture(new Float64Array([0, 1, 0, 0, 1, 0, 10, 10, 10, 1, 2, 0.5]));
    expect(cells.map((c) => c.seedIndex)).toEqual([0, 3]);
  });
});

describe('seeds', () => {
  it('are deterministic for the same rng seed and inside bounds', () => {
    const a = uniformSeeds(BOX, 100, createRng(7));
    const b = uniformSeeds(BOX, 100, createRng(7));
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const set of Object.values(SEED_SETS)) {
      for (let i = 0; i < set.length; i += 3) {
        expect(set[i]!).toBeGreaterThanOrEqual(BOX.min.x);
        expect(set[i]!).toBeLessThanOrEqual(BOX.max.x);
        expect(set[i + 1]!).toBeGreaterThanOrEqual(BOX.min.y);
        expect(set[i + 1]!).toBeLessThanOrEqual(BOX.max.y);
        expect(set[i + 2]!).toBeGreaterThanOrEqual(BOX.min.z);
        expect(set[i + 2]!).toBeLessThanOrEqual(BOX.max.z);
      }
    }
  });

  it('jittered grid produces roughly the requested count', () => {
    const n = SEED_SETS.jittered.length / 3;
    expect(n).toBeGreaterThan(200);
    expect(n).toBeLessThan(400);
  });

  it('adaptive seeds are denser near the focus', () => {
    const focus = { x: 1, y: 2, z: 1 };
    const near = (s: Float64Array) => {
      let count = 0;
      for (let i = 0; i < s.length; i += 3) {
        if (Math.hypot(s[i]! - focus.x, s[i + 1]! - focus.y, s[i + 2]! - focus.z) < 1) count++;
      }
      return count;
    };
    expect(near(SEED_SETS.adaptive)).toBeGreaterThan(
      2 * near(uniformSeeds(BOX, 300, createRng(3))),
    );
  });
});

describe('packFragments', () => {
  it('round-trips through packing', () => {
    const { frags } = fracture(uniformSeeds(BOX, 50, createRng(9)));
    const back = unpackFragments(packFragments(frags));
    expect(back).toHaveLength(frags.length);
    back.forEach((f, i) => {
      const src = frags[i]!;
      expect(f.centroid).toEqual(src.centroid);
      expect(f.volume).toBe(src.volume);
      expect(f.exteriorIndexCount).toBe(src.exteriorIndexCount);
      expect(Array.from(f.positions)).toEqual(Array.from(src.positions));
      expect(Array.from(f.uvs)).toEqual(Array.from(src.uvs));
      expect(Array.from(f.indices)).toEqual(Array.from(src.indices));
      expect(Array.from(f.hull)).toEqual(Array.from(src.hull));
      expect(Array.from(f.neighbors)).toEqual(Array.from(src.neighbors));
    });
  });
});
