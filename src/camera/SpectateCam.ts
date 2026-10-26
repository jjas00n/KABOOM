// 관람 카메라: 처음 autoSec 동안 중심점을 천천히 도는 자동 연출, 그 뒤엔 OrbitControls로 자유 관람.
// 자동 연출 중에 사용자가 드래그하면 바로 자유 관람으로 넘어간다.
// IDLE(건물 전경)에도 autoSec = Infinity로 쓴다.
import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraController, CameraPose } from './CameraRig';

export interface OrbitShot {
  radius: number;
  height: number;
  /** rad/s */
  speed: number;
  autoSec: number;
}

export class SpectateCam implements CameraController {
  private readonly center = new Vector3();
  private shot: OrbitShot = { radius: 30, height: 12, speed: 0.2, autoSec: 4 };
  private angle = 0;
  private elapsed = 0;
  private manual = false;

  constructor(private readonly controls: OrbitControls) {
    controls.addEventListener('start', () => {
      this.manual = true;
    });
  }

  /** from(지금 카메라 위치)에서 이어지는 각도로 center 주위를 돌기 시작 */
  start(center: Vector3, from: Vector3, shot: OrbitShot): void {
    this.center.copy(center);
    this.shot = shot;
    this.angle = Math.atan2(from.x - center.x, from.z - center.z);
    this.elapsed = 0;
    this.manual = false;
    this.controls.target.copy(center);
  }

  get isManual(): boolean {
    return this.manual;
  }

  update(dt: number, camera: PerspectiveCamera, out: CameraPose): void {
    if (!this.manual && this.elapsed < this.shot.autoSec) {
      this.elapsed += dt;
      this.angle += this.shot.speed * dt;
      out.position.set(
        this.center.x + Math.sin(this.angle) * this.shot.radius,
        this.center.y + this.shot.height,
        this.center.z + Math.cos(this.angle) * this.shot.radius,
      );
      out.target.copy(this.center);
      return;
    }
    // 자유 관람: OrbitControls가 카메라를 움직이고 그 자세를 그대로 쓴다
    this.manual = true;
    this.controls.update();
    out.position.copy(camera.position);
    out.target.copy(this.controls.target);
  }
}
