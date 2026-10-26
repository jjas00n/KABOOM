// 카메라 리그: 실제 카메라를 갖고, 지금 컨트롤러가 원하는 자세로 맞춘다.
// - 컨트롤러가 바뀌면 blendSec 동안 이전 자세 → 새 자세로 부드럽게 넘어간다 (위치 lerp, 방향 slerp)
// - 흔들림은 마지막에 얹고, 다음 프레임 시작에 걷어낸다 (컨트롤러·OrbitControls가 흔들린 값을 읽지 않게)
import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { CAMERA } from '../config';
import { CameraShake } from './CameraShake';
import { easeInOutCubic } from './easing';

export interface CameraPose {
  position: Vector3;
  /** 바라보는 점 */
  target: Vector3;
}

export interface CameraController {
  /** 이번 프레임에 원하는 자세를 out에 쓴다. camera는 흔들림을 뺀 현재 자세. */
  update(dt: number, camera: PerspectiveCamera, out: CameraPose): void;
}

const UP = new Vector3(0, 1, 0);
const scratchMatrix = new Matrix4();

export class CameraRig {
  readonly shake = new CameraShake();
  private controller: CameraController | null = null;
  private readonly pose: CameraPose = { position: new Vector3(), target: new Vector3() };
  private readonly targetQuat = new Quaternion();
  private readonly fromPos = new Vector3();
  private readonly fromQuat = new Quaternion();
  private blendTime = 0;
  private blendDuration = 0;
  /** 흔들림을 얹기 전 자세 */
  private readonly basePos = new Vector3();
  private readonly baseQuat = new Quaternion();

  constructor(readonly camera: PerspectiveCamera) {
    this.basePos.copy(camera.position);
    this.baseQuat.copy(camera.quaternion);
  }

  get current(): CameraController | null {
    return this.controller;
  }

  /** 지금 자세에서 blendSec 동안 섞으며 새 컨트롤러로 넘어간다 (0이면 즉시) */
  setController(controller: CameraController, blendSec: number = CAMERA.blendSec): void {
    this.controller = controller;
    this.fromPos.copy(this.basePos);
    this.fromQuat.copy(this.baseQuat);
    this.blendTime = 0;
    this.blendDuration = blendSec;
  }

  get blending(): boolean {
    return this.blendTime < this.blendDuration;
  }

  update(dt: number): void {
    const cam = this.camera;
    cam.position.copy(this.basePos);
    cam.quaternion.copy(this.baseQuat);

    if (this.controller) {
      this.controller.update(dt, cam, this.pose);
      scratchMatrix.lookAt(this.pose.position, this.pose.target, UP);
      this.targetQuat.setFromRotationMatrix(scratchMatrix);
      if (this.blendTime < this.blendDuration) {
        this.blendTime += dt;
        const t = easeInOutCubic(this.blendTime / this.blendDuration);
        cam.position.lerpVectors(this.fromPos, this.pose.position, t);
        cam.quaternion.slerpQuaternions(this.fromQuat, this.targetQuat, t);
      } else {
        cam.position.copy(this.pose.position);
        cam.quaternion.copy(this.targetQuat);
      }
    }

    this.basePos.copy(cam.position);
    this.baseQuat.copy(cam.quaternion);
    this.shake.update(dt);
    this.shake.apply(cam);
    cam.updateMatrixWorld();
  }
}
