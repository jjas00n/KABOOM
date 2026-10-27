// 연기/먼지 스프라이트 텍스처: 흰색 + 알파. 가장자리가 부드럽게 사라지는 뭉게구름 모양.
// 원형 그라디언트 여러 개를 겹쳐 덩어리진 모양을 만든다 (난수 시드 고정 → 매번 같은 모양).
import { CanvasTexture } from 'three';
import { createRng } from '../fracture/seeds';

const SIZE = 128;
const BLOBS = 14;
const SEED = 4242;

export function createPuffTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const rng = createRng(SEED);
  const half = SIZE / 2;
  // 가운데 큰 덩어리 + 주변 작은 덩어리들. 바깥 원(반지름 half) 밖으로는 안 나가게
  for (let i = 0; i < BLOBS; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = i === 0 ? 0 : rng() * half * 0.35;
    const r = i === 0 ? half * 0.6 : half * (0.25 + rng() * 0.3);
    const x = half + Math.cos(angle) * dist;
    const y = half + Math.sin(angle) * dist;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = i === 0 ? 0.55 : 0.25 + rng() * 0.2;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  return new CanvasTexture(canvas);
}
