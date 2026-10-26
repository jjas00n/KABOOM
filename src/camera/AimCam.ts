// 포신 시점 조준 카메라: 포신 뒤·위 3인칭. 포신과 함께 돈다.
// 뒤로 물러나는 방향은 수평 방향만 쓴다 (포신을 높이 들어도 카메라가 땅으로 파고들지 않게).
import { Vector3, type PerspectiveCamera } from 'three';
import { CAMERA } from '../config';
import type { Cannon } from '../game/Cannon';
import type { CameraController, CameraPose } from './CameraRig';

const pivot = new Vector3();
const dir = new Vector3();
const flat = new Vector3();

export class AimCam implements CameraController {
  constructor(private readonly cannon: Cannon) {}

  /** 대포의 (다 솟아오른) 현재 조준에 맞는 자세 */
  poseFor(out: CameraPose): CameraPose {
    this.cannon.pivotWorld(pivot);
    this.cannon.aimDirection(dir);
    flat.set(dir.x, 0, dir.z).normalize();
    out.position.copy(pivot).addScaledVector(flat, -CAMERA.aimBack);
    out.position.y += CAMERA.aimUp;
    out.target.copy(pivot).addScaledVector(dir, CAMERA.aimAhead);
    return out;
  }

  update(_dt: number, _camera: PerspectiveCamera, out: CameraPose): void {
    this.poseFor(out);
  }
}
