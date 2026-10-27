// 관람 카메라: 처음 autoSec 동안 중심점을 천천히 도는 자동 연출, 그 뒤엔 OrbitControls로 자유 관람.
// 자동 연출 중에 사용자가 드래그하면 바로 자유 관람으로 넘어간다.
// IDLE(건물 전경)에도 autoSec = Infinity로 쓴다.
// 화재 관람: zoomPerSec로 반경·높이를 서서히 늘리고, follow 점(화재 중심)을 천천히 따라간다.
import { Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CameraController, CameraPose } from './CameraRig';
import { smoothing } from './easing';

export interface OrbitShot {
  radius: number;
  height: number;
  /** rad/s */
  speed: number;
  autoSec: number;
  /** 반경·높이 증가율 (/s, 처음 값 대비). 없으면 0 */
  zoomPerSec?: number;
  /** 줌 상한 (처음 값의 배수) */
  zoomMax?: number;
  /** 자동 연출 중 중심이 따라갈 점 (매 프레임 읽는다) */
  follow?: Vector3 | null;
  /** 따라가기 스무딩 시간상수 (s) */
  followSec?: number;
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
      const shot = this.shot;
      this.elapsed += dt;
      this.angle += shot.speed * dt;
      if (shot.follow) this.center.lerp(shot.follow, smoothing(dt, shot.followSec ?? 1));
      const zoom = Math.min(1 + (shot.zoomPerSec ?? 0) * this.elapsed, shot.zoomMax ?? 1);
      out.position.set(
        this.center.x + Math.sin(this.angle) * shot.radius * zoom,
        this.center.y + shot.height * zoom,
        this.center.z + Math.cos(this.angle) * shot.radius * zoom,
      );
      out.target.copy(this.center);
      this.controls.target.copy(this.center); // 자유 관람으로 넘어가도 같은 점을 돈다
      return;
    }
    // 자유 관람: OrbitControls가 카메라를 움직이고 그 자세를 그대로 쓴다
    this.manual = true;
    this.controls.update();
    out.position.copy(camera.position);
    out.target.copy(this.controls.target);
  }
}
