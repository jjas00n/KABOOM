// 조준 중 예상 궤적 점선. 버퍼는 한 번만 만들고 매 프레임 덮어쓴다 (할당 없음).
import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineDashedMaterial,
  type Scene,
  type Vector3,
} from 'three';
import { PHYSICS, PROJECTILE } from '../config';
import { simulateTrajectory, trajectoryCapacity } from './ballistics';

export class TrajectoryLine {
  private readonly line: Line;
  private readonly positions: Float32Array;
  private readonly distances: Float32Array;

  constructor(scene: Scene) {
    const capacity = trajectoryCapacity(PROJECTILE.trajectoryStepSec, PROJECTILE.trajectoryMaxSec);
    this.positions = new Float32Array(capacity * 3);
    this.distances = new Float32Array(capacity);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    // LineDashedMaterial은 선을 따라 잰 거리 attribute로 점선을 끊는다
    geo.setAttribute('lineDistance', new BufferAttribute(this.distances, 1));
    this.line = new Line(
      geo,
      new LineDashedMaterial({
        color: PROJECTILE.trajectoryColor,
        dashSize: PROJECTILE.trajectoryDashSize,
        gapSize: PROJECTILE.trajectoryGapSize,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);
  }

  set visible(v: boolean) {
    this.line.visible = v;
  }

  /** gravityScale: 발사체의 중력 배수 (파이어볼은 작다) */
  update(origin: Vector3, velocity: Vector3, gravityScale = 1): void {
    const p = this.positions;
    const n = simulateTrajectory(
      origin,
      velocity,
      PROJECTILE.trajectoryStepSec,
      PROJECTILE.trajectoryMaxSec,
      p,
      0,
      PHYSICS.fixedTimestep,
      PHYSICS.gravity.y * gravityScale,
    );
    this.distances[0] = 0;
    for (let i = 1; i < n; i++) {
      const dx = p[i * 3]! - p[i * 3 - 3]!;
      const dy = p[i * 3 + 1]! - p[i * 3 - 2]!;
      const dz = p[i * 3 + 2]! - p[i * 3 - 1]!;
      this.distances[i] = this.distances[i - 1]! + Math.hypot(dx, dy, dz);
    }
    const geo = this.line.geometry;
    geo.setDrawRange(0, n);
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('lineDistance').needsUpdate = true;
  }
}
