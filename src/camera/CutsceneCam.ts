// 건물 → 대포 스플라인 비행 컷신 카메라
// 위치: 시작 자세 → 건물 전경(옆으로 비낀 높은 곳) → 조준 카메라 자세, CatmullRom 곡선
// 바라보는 점: 건물 중심 → 조준 목표로 서서히. easeInOutCubic, 길이 cutsceneDurationSec.
import { CatmullRomCurve3, Vector3, type PerspectiveCamera } from 'three';
import { CAMERA } from '../config';
import type { CameraController, CameraPose } from './CameraRig';
import { clamp01, easeInOutCubic } from './easing';

export class CutsceneCam implements CameraController {
  private readonly path: CatmullRomCurve3;
  private readonly lookFrom: Vector3;
  private readonly lookTo: Vector3;
  private elapsed = 0;

  /**
   * start: 지금 카메라 위치, buildingCenter: 바라볼 건물 중심,
   * cannonDir: 건물 → 대포 수평 방향 (전경 지점을 정할 때 쓴다), end: 끝 자세 (= 조준 카메라 자세)
   */
  constructor(
    start: Vector3,
    buildingCenter: Vector3,
    cannonDir: Vector3,
    end: CameraPose,
    readonly duration: number = CAMERA.cutsceneDurationSec,
  ) {
    const side = Math.atan2(cannonDir.x, cannonDir.z) + CAMERA.cutsceneSideAngle;
    const overview = new Vector3(
      buildingCenter.x + Math.sin(side) * CAMERA.cutsceneOverviewRadius,
      CAMERA.cutsceneOverviewHeight,
      buildingCenter.z + Math.cos(side) * CAMERA.cutsceneOverviewRadius,
    );
    this.path = new CatmullRomCurve3(
      [start.clone(), overview, end.position.clone()],
      false,
      'centripetal',
    );
    this.lookFrom = buildingCenter.clone();
    this.lookTo = end.target.clone();
  }

  get progress(): number {
    return clamp01(this.elapsed / this.duration);
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  /** 시간을 건너뛰지 않고 자세만 계산 (테스트·미리보기용) */
  poseAt(t: number, out: CameraPose): CameraPose {
    const e = easeInOutCubic(t);
    this.path.getPoint(e, out.position);
    // 바라보는 점은 후반에 몰아서 돌린다: 처음엔 건물을, 도착할 땐 조준 방향을
    out.target.lerpVectors(this.lookFrom, this.lookTo, easeInOutCubic(clamp01(e * 1.25 - 0.25)));
    return out;
  }

  update(dt: number, _camera: PerspectiveCamera, out: CameraPose): void {
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    this.poseAt(this.progress, out);
  }
}
