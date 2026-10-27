// 방향광 그림자 범위를 '볼 만한 곳'(건물 + 움직이는 잔해)에 맞춘다.
// 고정 범위(반경 30m)는 멀쩡한 건물엔 해상도가 남고, 잔해가 멀리 흩어지면 그림자가 잘린다.
// 범위는 지수 스무딩으로 천천히 바꾸고, 중심은 그림자 맵 텍셀 단위로 스냅해 가장자리가 떨리지 않게 한다.
import { Vector3, type DirectionalLight } from 'three';
import { RENDER } from '../config';
import type { Aabb, Vec3Like } from '../fracture/polyhedron';

const WORLD_UP = new Vector3(0, 1, 0);
const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchDir = new Vector3();

/** 포커스 박스를 감싸는 그림자 반경 (구 반지름 + 여유), [minSize, maxSize]로 자름 */
export function shadowHalfSize(
  box: Aabb,
  margin: number = RENDER.shadowMargin,
  minSize: number = RENDER.shadowMinSize,
  maxSize: number = RENDER.shadowMaxSize,
): number {
  const dx = box.max.x - box.min.x;
  const dy = box.max.y - box.min.y;
  const dz = box.max.z - box.min.z;
  const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz) + margin;
  return Math.min(Math.max(radius, minSize), maxSize);
}

/**
 * center를 광원 시점 평면(광원 방향에 수직)에서 texel 간격 격자로 스냅한다 (제자리 수정).
 * 광원 방향 성분은 그대로 둔다. lightDir: 광원 쪽 단위 벡터.
 */
export function snapToTexels(center: Vector3, lightDir: Vector3, texel: number): Vector3 {
  const dir = scratchDir.copy(lightDir).normalize();
  const right = scratchRight.crossVectors(WORLD_UP, dir);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0); // 광원이 바로 위
  right.normalize();
  const up = scratchUp.crossVectors(dir, right);
  const r = center.dot(right);
  const u = center.dot(up);
  center.addScaledVector(right, Math.round(r / texel) * texel - r);
  center.addScaledVector(up, Math.round(u / texel) * texel - u);
  return center;
}

export class ShadowFit {
  private readonly lightDir: Vector3;
  private readonly targetCenter = new Vector3();
  private readonly center = new Vector3();
  private readonly snapped = new Vector3();
  private halfSize: number = RENDER.shadowCameraSize;
  private initialized = false;
  private readonly box: Aabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

  constructor(
    private readonly light: DirectionalLight,
    lightDir: Vec3Like,
  ) {
    this.lightDir = new Vector3(lightDir.x, lightDir.y, lightDir.z).normalize();
    light.shadow.camera.near = 1;
    this.apply();
  }

  /** 포커스 박스를 비우고 시작 (다음 include가 첫 점) */
  begin(): void {
    const { min, max } = this.box;
    min.x = min.y = min.z = Infinity;
    max.x = max.y = max.z = -Infinity;
  }

  includeBox(b: Aabb): void {
    this.includePoint(b.min);
    this.includePoint(b.max);
  }

  includePoint(p: Vec3Like): void {
    const { min, max } = this.box;
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }

  /** 렌더 프레임마다: begin/include 로 모은 박스에 맞춘다. 포커스가 비었으면 그대로 */
  update(dt: number): void {
    const { min, max } = this.box;
    if (min.x > max.x) return;
    const targetHalf = shadowHalfSize(this.box);
    this.targetCenter.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
    if (!this.initialized) {
      this.initialized = true;
      this.center.copy(this.targetCenter);
      this.halfSize = targetHalf;
    } else {
      const k = 1 - Math.exp(-dt / RENDER.shadowSmoothingSec);
      this.center.lerp(this.targetCenter, k);
      this.halfSize += (targetHalf - this.halfSize) * k;
    }
    this.apply();
  }

  private apply(): void {
    const half = this.halfSize;
    const texel = (2 * half) / RENDER.shadowMapSize;
    snapToTexels(this.snapped.copy(this.center), this.lightDir, texel);
    const { light } = this;
    const cam = light.shadow.camera;
    light.position.copy(this.snapped).addScaledVector(this.lightDir, RENDER.shadowLightDistance);
    light.target.position.copy(this.snapped);
    light.target.updateMatrixWorld();
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.far = RENDER.shadowLightDistance + half * 2;
    cam.updateProjectionMatrix();
  }
}
