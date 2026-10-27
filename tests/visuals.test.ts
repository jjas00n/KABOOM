import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RENDER } from '../src/config';
import { buildFragment, type Fragment } from '../src/fracture/Fragment';
import { REST_ATTRIBUTE, withRest } from '../src/fracture/FragmentMeshes';
import { runFracture } from '../src/fracture/pipeline';
import { boxPolyhedron } from '../src/fracture/polyhedron';
import { createRng, uniformSeeds } from '../src/fracture/seeds';
import { voronoiCells } from '../src/fracture/voronoi';
import { ParticleRing } from '../src/fx/ParticleRing';
import { shadowHalfSize, snapToTexels } from '../src/fx/ShadowFit';

const BOX = { min: { x: 3, y: 1, z: -2 }, max: { x: 7, y: 4, z: 0 } };
const UV_SCALE = 0.5;

/** 외면 정점마다 (월드 좌표, uv, 법선 주축) */
function exteriorVertices(frags: readonly Fragment[]) {
  const out: { world: Vector3; u: number; v: number; axis: number }[] = [];
  for (const f of frags) {
    const exteriorVertexCount = Math.max(...f.indices.subarray(0, f.exteriorIndexCount)) + 1;
    for (let k = 0; k < exteriorVertexCount; k++) {
      const n = [f.normals[k * 3]!, f.normals[k * 3 + 1]!, f.normals[k * 3 + 2]!].map(Math.abs);
      out.push({
        world: new Vector3(
          f.positions[k * 3]! + f.centroid.x,
          f.positions[k * 3 + 1]! + f.centroid.y,
          f.positions[k * 3 + 2]! + f.centroid.z,
        ),
        u: f.uvs[k * 2]!,
        v: f.uvs[k * 2 + 1]!,
        axis: n.indexOf(Math.max(...n)),
      });
    }
  }
  return out;
}

describe('fragment UV (member box projection)', () => {
  const cells = voronoiCells(boxPolyhedron(BOX.min, BOX.max), uniformSeeds(BOX, 60, createRng(5)));
  const frags = cells.map((c) => buildFragment(c, UV_SCALE, 0, 0, BOX.min));

  it('exterior UV is the world point minus the box corner, projected on the face axis', () => {
    const verts = exteriorVertices(frags);
    expect(verts.length).toBeGreaterThan(0);
    for (const { world, u, v, axis } of verts) {
      const d = world.clone().sub(new Vector3(BOX.min.x, BOX.min.y, BOX.min.z));
      const [eu, ev] = axis === 0 ? [d.z, d.y] : axis === 1 ? [d.x, d.z] : [d.x, d.y];
      expect(u).toBeCloseTo(eu * UV_SCALE, 4);
      expect(v).toBeCloseTo(ev * UV_SCALE, 4);
    }
  });

  it('neighbouring fragments give the same UV at the same point of a shared face (texture continues)', () => {
    const verts = exteriorVertices(frags);
    const seen = new Map<string, { u: number; v: number }>();
    let shared = 0;
    for (const { world, u, v, axis } of verts) {
      const key = `${axis}:${world.x.toFixed(4)},${world.y.toFixed(4)},${world.z.toFixed(4)}`;
      const prev = seen.get(key);
      if (prev) {
        shared++;
        expect(u).toBeCloseTo(prev.u, 4);
        expect(v).toBeCloseTo(prev.v, 4);
      } else seen.set(key, { u, v });
    }
    expect(shared).toBeGreaterThan(0); // 조각 경계의 꼭짓점은 여러 조각이 공유한다
  });

  it('each member starts its own texture at its box corner (pipeline passes box.min)', () => {
    const other = { min: { x: 7, y: 1, z: -2 }, max: { x: 9, y: 4, z: 0 } };
    const result = runFracture({
      jobs: [
        { box: BOX, seeds: uniformSeeds(BOX, 8, createRng(1)) },
        { box: other, seeds: uniformSeeds(other, 8, createRng(2)) },
      ],
      uvScale: UV_SCALE,
    });
    for (const f of result) {
      const min = f.member === 0 ? BOX.min : other.min;
      for (const { world, u, axis } of exteriorVertices([f])) {
        const d = axis === 0 ? world.z - min.z : world.x - min.x;
        expect(u).toBeCloseTo(d * UV_SCALE, 4);
      }
    }
  });
});

describe('withRest (triplanar input)', () => {
  it('rest = local vertex + fragment centroid', () => {
    const frag = { centroid: { x: 1, y: -2, z: 3 } } as Fragment;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.5, 1, -1]), 3));
    withRest(g, frag);
    expect(Array.from(g.getAttribute(REST_ATTRIBUTE).array)).toEqual([1, -2, 3, 1.5, -1, 2]);
  });
});

describe('ShadowFit', () => {
  it('half size covers the focus box (bounding sphere + margin)', () => {
    const box = { min: { x: -10, y: 0, z: -8 }, max: { x: 10, y: 20, z: 8 } };
    const half = shadowHalfSize(box, 2, 1, 1000);
    expect(half).toBeCloseTo(0.5 * Math.hypot(20, 20, 16) + 2, 6);
  });

  it('half size is clamped to [min, max]', () => {
    const tiny = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const huge = { min: { x: -500, y: 0, z: -500 }, max: { x: 500, y: 10, z: 500 } };
    expect(shadowHalfSize(tiny)).toBe(RENDER.shadowMinSize);
    expect(shadowHalfSize(huge)).toBe(RENDER.shadowMaxSize);
  });

  it('snaps the center to whole texels across the light, keeping the along-light part', () => {
    const light = new Vector3(20, 35, 15).normalize();
    const texel = 0.03;
    const p = new Vector3(3.217, 5.031, -7.77);
    const s = snapToTexels(p.clone(), light, texel);
    // 광원 방향 성분은 그대로
    expect(s.dot(light)).toBeCloseTo(p.dot(light), 6);
    // 수직 평면에서 움직인 거리 ≤ 반 텍셀 × √2
    expect(s.distanceTo(p)).toBeLessThanOrEqual((texel / 2) * Math.SQRT2 + 1e-9);
    // 다시 스냅해도 그대로 (격자 위)
    expect(snapToTexels(s.clone(), light, texel).distanceTo(s)).toBeLessThan(1e-9);
  });
});

describe('ParticleRing', () => {
  it('hands out slots oldest-first and wraps around', () => {
    const ring = new ParticleRing(4);
    expect([0, 1, 2, 3, 4, 5].map(() => ring.allocate())).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('reports only the slots written this frame', () => {
    const ring = new ParticleRing(10);
    expect(ring.dirtyRanges()).toEqual([]);
    ring.allocate();
    ring.allocate();
    expect(ring.dirtyRanges()).toEqual([{ start: 0, count: 2 }]);
    ring.flush([]);
    for (let i = 0; i < 3; i++) ring.allocate();
    expect(ring.dirtyRanges()).toEqual([{ start: 2, count: 3 }]);
  });

  it('splits the range in two when it wraps, and covers everything after a full lap', () => {
    const ring = new ParticleRing(10);
    for (let i = 0; i < 8; i++) ring.allocate();
    ring.flush([]);
    for (let i = 0; i < 4; i++) ring.allocate(); // 8, 9, 0, 1
    expect(ring.dirtyRanges()).toEqual([
      { start: 8, count: 2 },
      { start: 0, count: 2 },
    ]);
    for (let i = 0; i < 20; i++) ring.allocate();
    expect(ring.dirtyRanges()).toEqual([{ start: 0, count: 10 }]);
  });

  it('marks only the dirty ranges of attributes for upload', () => {
    const ring = new ParticleRing(10);
    const attr = new BufferAttribute(new Float32Array(30), 3);
    ring.allocate();
    ring.allocate();
    ring.flush([attr]);
    expect(attr.updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(attr.version).toBe(1);
    ring.flush([attr]); // 쓴 게 없으면 안 올린다
    expect(attr.version).toBe(1);
  });
});
