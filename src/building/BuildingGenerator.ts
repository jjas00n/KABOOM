// 파라미터 기반 절차적 건물 생성
// 순수 함수: 부재(축 정렬 박스) 목록만 만든다. 분할·렌더·물리는 호출 쪽 몫.
//
// 단면 (외곽 한쪽, 바깥 = 왼쪽):
//   |패널|  보 |      ← 기둥 폭 안에 패널(바깥) + 외곽 보(안쪽)가 겹치지 않게 들어간다
//   |<--- 기둥 --->|
// 층 k: 기둥은 아래 슬래브(또는 기초) 윗면 ~ 이 층 슬래브 아랫면, 보는 슬래브 바로 아래.
import { BUILDING } from '../config';
import type { Aabb } from '../fracture/polyhedron';
import { box, type Member } from './Member';
import { column } from './members/Column';
import { slab } from './members/Slab';
import { facadeFrame, wallPanel, windowOpening } from './members/WallPanel';
import { windowGlass } from './members/Window';

export interface BuildingParams {
  floors: number;
  baysX: number;
  baysZ: number;
  floorHeight: number;
  columnSpacing: number;
  windowRatio: number;
  /** 분할 시드 난수용. 레이아웃 자체는 결정적이다. */
  seed: number;
}

export const DEFAULT_BUILDING: BuildingParams = {
  floors: BUILDING.floors,
  baysX: BUILDING.baysX,
  baysZ: BUILDING.baysZ,
  floorHeight: BUILDING.floorHeight,
  columnSpacing: BUILDING.columnSpacing,
  windowRatio: BUILDING.windowRatio,
  seed: BUILDING.seed,
};

export interface Building {
  members: Member[];
  /** 기둥 바깥면까지의 외곽 (기초 제외) */
  footprint: Aabb;
  height: number;
}

export function generateBuilding(params: BuildingParams = DEFAULT_BUILDING): Building {
  const { floors, baysX, baysZ, floorHeight: H, columnSpacing: S, windowRatio } = params;
  const c = BUILDING.columnSize;
  const half = c / 2;
  const slabT = BUILDING.slabThickness;
  const F = BUILDING.foundationThickness;
  const members: Member[] = [];

  // 기둥 중심선 (건물 중심이 원점)
  const xs = Array.from({ length: baysX + 1 }, (_, i) => (i - baysX / 2) * S);
  const zs = Array.from({ length: baysZ + 1 }, (_, j) => (j - baysZ / 2) * S);
  const x0 = xs[0]! - half;
  const x1 = xs[baysX]! + half;
  const z0 = zs[0]! - half;
  const z1 = zs[baysZ]! + half;
  const footprint = box(x0, 0, z0, x1, 0, z1);

  const m = BUILDING.foundationMargin;
  members.push({
    kind: 'foundation',
    box: box(x0 - m, 0, z0 - m, x1 + m, F, z1 + m),
    anchor: true,
  });

  for (let k = 0; k < floors; k++) {
    const base = F + k * H; // 이 층 바닥 (기초 또는 아래 슬래브 윗면)
    const top = base + H; // 이 층 슬래브 윗면
    const slabBottom = top - slabT;
    const beamBottom = slabBottom - BUILDING.beamDepth;

    for (const x of xs) for (const z of zs) members.push(column(x, z, base, slabBottom, c));
    members.push(slab(footprint, slabBottom, top));

    // x 방향 보: z 격자선마다 기둥 사이
    zs.forEach((z, j) => {
      const [a, b] = beamBand(z, j, baysZ);
      for (let i = 0; i < baysX; i++) {
        members.push(beam(box(xs[i]! + half, beamBottom, a, xs[i + 1]! - half, slabBottom, b)));
      }
    });
    // z 방향 보: x 격자선마다 기둥 사이
    xs.forEach((x, i) => {
      const [a, b] = beamBand(x, i, baysX);
      for (let j = 0; j < baysZ; j++) {
        members.push(beam(box(a, beamBottom, zs[j]! + half, b, slabBottom, zs[j + 1]! - half)));
      }
    });

    // 외벽 패널 + 유리: 네 면, 칸마다
    const pt = BUILDING.panelThickness;
    const facades = [
      { frame: facadeFrame(true, z0, z0 + pt), lines: xs },
      { frame: facadeFrame(true, z1 - pt, z1), lines: xs },
      { frame: facadeFrame(false, x0, x0 + pt), lines: zs },
      { frame: facadeFrame(false, x1 - pt, x1), lines: zs },
    ];
    for (const { frame, lines } of facades) {
      for (let i = 0; i + 1 < lines.length; i++) {
        const u0 = lines[i]! + half;
        const u1 = lines[i + 1]! - half;
        members.push(...wallPanel(frame, u0, u1, base, slabBottom, windowRatio));
        const w = windowOpening(u0, u1, base, slabBottom, windowRatio);
        if (w) members.push(windowGlass(frame, w.u0, w.u1, w.y0, w.y1));
      }
    }
  }

  // 옥상 난간: 앞/뒤는 전체 길이, 좌/우는 그 사이 (모서리 겹침 방지)
  const roof = F + floors * H;
  const ph = roof + BUILDING.parapetHeight;
  const t = BUILDING.parapetThickness;
  for (const b of [
    box(x0, roof, z0, x1, ph, z0 + t),
    box(x0, roof, z1 - t, x1, ph, z1),
    box(x0, roof, z0 + t, x0 + t, ph, z1 - t),
    box(x1 - t, roof, z0 + t, x1, ph, z1 - t),
  ]) {
    members.push({ kind: 'parapet', box: b, anchor: false });
  }

  return { members, footprint, height: ph };
}

/** 격자선 하나의 보 폭 범위. 외곽선은 패널과 겹치지 않게 기둥 안쪽 면에 붙인다. */
function beamBand(line: number, index: number, bays: number): [number, number] {
  const half = BUILDING.columnSize / 2;
  const w = BUILDING.beamWidth;
  if (index === 0) return [line + half - w, line + half];
  if (index === bays) return [line - half, line - half + w];
  return [line - w / 2, line + w / 2];
}

function beam(b: Aabb): Member {
  return { kind: 'beam', box: b, anchor: false };
}
