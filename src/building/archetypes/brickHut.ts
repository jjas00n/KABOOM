// 벽돌 오두막: 석재 기단 + 러닝본드 블록 벽(문·창 구멍) + 벽돌 박공 지붕.
// 블록(벽돌 몇 장 길이) = 부재 하나 → 블록 사이 이음매(모르타르)가 약하다 (MATERIALS.brick.jointFactor).
import { TINY } from '../../config';
import type { Rng } from '../../fracture/seeds';
import { box, type Member } from '../Member';
import { boxMember, gable } from '../shapes';

/** 한 줄의 구간 [u0, u1] 안 블록 경계: 러닝본드 offset, 구멍(holes)은 비운다. 너무 짧은 조각은 합친다 */
function blocks(
  u0: number,
  u1: number,
  offset: number,
  holes: readonly (readonly [number, number])[],
): [number, number][] {
  const { block, minPiece } = TINY.brickHut;
  const cuts = new Set<number>([u0, u1]);
  for (let u = u0 + offset; u < u1; u += block) if (u > u0) cuts.add(u);
  for (const [a, b] of holes) {
    if (a > u0 && a < u1) cuts.add(a);
    if (b > u0 && b < u1) cuts.add(b);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const inHole = (a: number, b: number) =>
    holes.some(([h0, h1]) => a >= h0 - 1e-9 && b <= h1 + 1e-9);
  // 짧은 조각은 구멍 가장자리가 아닌 쪽 경계를 지워 합친다
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (inHole(a, b)) continue;
    const last = out[out.length - 1];
    const holeEdge = holes.some(([h0, h1]) => Math.abs(a - h1) < 1e-9 || Math.abs(a - h0) < 1e-9);
    if (last && last[1] === a && !holeEdge && (b - a < minPiece || last[1] - last[0] < minPiece)) {
      last[1] = b;
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

export function brickHut(rng: Rng): Member[] {
  const t = TINY.brickHut;
  const [bw, bh, bd] = t.base;
  const x1 = bw / 2;
  const z1 = bd / 2;
  const w = t.wall;
  const members: Member[] = [
    boxMember('foundation', 'stone', box(-x1, 0, -z1, x1, bh, z1), { anchor: true }),
  ];
  const [doorW, doorH] = t.door;
  const [winW, winH, winSill] = t.window;
  // 변주: 문 위치 (가운데 / 왼쪽)
  const doorC = rng() < 0.5 ? 0 : -x1 / 2.5;
  const top = bh + t.courses * t.course;

  for (let k = 0; k < t.courses; k++) {
    const y0 = bh + k * t.course;
    const y1 = y0 + t.course;
    const offset = k % 2 === 0 ? t.block : t.block / 2;
    const span = (lo: number, hi: number) => lo < y1 - 1e-9 && hi > y0 + 1e-9;
    // 앞 벽 (z = -z1 쪽, 전체 길이) — 문
    const door: [number, number][] = span(bh, bh + doorH)
      ? [[doorC - doorW / 2, doorC + doorW / 2]]
      : [];
    for (const [a, b] of blocks(-x1, x1, offset, door)) {
      members.push(boxMember('brickBlock', 'brick', box(a, y0, -z1, b, y1, -z1 + w)));
    }
    // 뒤 벽 — 창
    const win: [number, number][] = span(bh + winSill, bh + winSill + winH)
      ? [[-winW / 2, winW / 2]]
      : [];
    for (const [a, b] of blocks(-x1, x1, offset + t.block / 4, win)) {
      members.push(boxMember('brickBlock', 'brick', box(a, y0, z1 - w, b, y1, z1)));
    }
    // 옆 벽 (앞뒤 벽 사이)
    for (const sx of [-1, 1]) {
      const x0 = sx < 0 ? -x1 : x1 - w;
      for (const [a, b] of blocks(-z1 + w, z1 - w, offset / 2, [])) {
        members.push(boxMember('brickBlock', 'brick', box(x0, y0, a, x0 + w, y1, b)));
      }
    }
  }
  // 박공 지붕 (용마루 x 방향): 벽 위를 전부 덮는다
  members.push(gable('roof', 'brick', box(-x1, top, -z1, x1, top + t.roofHeight, z1), 'x'));
  return members;
}
