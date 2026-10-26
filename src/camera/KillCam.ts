// 킬캠 카메라: 관통 경로를 옆에서 보며 천천히 돌고, 포탄 쪽으로 시선을 끌고 간다.
// 위치 = 경로 중심 + 옆(경로에 수직인 수평 방향) × 거리 - 진행 방향 × 거리 × camBehind + 위.
// 옆은 원래 카메라가 있던 쪽을 고른다 (킬캠 진입 때 화면이 반대로 뒤집히지 않게).
import { Vector3, type PerspectiveCamera } from 'three';
import { XRAY } from '../config';
import type { CameraController, CameraPose } from './CameraRig';
import type { ChaseTarget } from './ChaseCam';
import { clamp01, easeInOutCubic } from './easing';

const UP = new Vector3(0, 1, 0);
const side = new Vector3();
const orbitSide = new Vector3();

export class KillCam implements CameraController {
  private readonly center = new Vector3();
  private readonly dir = new Vector3();
  private readonly sideBase = new Vector3();
  private distance: number = XRAY.camDistance;
  private elapsed = 0;
  private target: ChaseTarget | null = null;

  /**
   * contact: 충돌(예상) 지점, dir: 진행 방향(단위), depth: 관통 깊이(m),
   * from: 지금 카메라 위치 (어느 옆에서 볼지 정하는 데 쓴다), target: 포탄
   */
  start(contact: Vector3, dir: Vector3, depth: number, from: Vector3, target: ChaseTarget): void {
    this.dir.copy(dir);
    this.center.copy(contact).addScaledVector(dir, depth / 2);
    this.distance = XRAY.camDistance + depth / 2;
    side.crossVectors(dir, UP);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); // 거의 수직으로 떨어지는 포탄
    side.normalize();
    if (side.dot(from.clone().sub(this.center)) < 0) side.negate();
    this.sideBase.copy(side);
    this.elapsed = 0;
    this.target = target;
  }

  update(dt: number, _camera: PerspectiveCamera, out: CameraPose): void {
    this.elapsed += dt;
    const orbit = XRAY.camOrbit * easeInOutCubic(clamp01(this.elapsed / XRAY.camOrbitSec));
    orbitSide.copy(this.sideBase).applyAxisAngle(UP, orbit);
    out.position
      .copy(this.center)
      .addScaledVector(orbitSide, this.distance)
      .addScaledVector(this.dir, -this.distance * XRAY.camBehind)
      .addScaledVector(UP, XRAY.camHeight);
    out.target.copy(this.center);
    if (this.target) out.target.lerp(this.target.position, XRAY.camTrack);
  }
}
