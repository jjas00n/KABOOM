// 카메라 흔들림: trauma(0~1)를 쌓으면 trauma²에 비례해 흔들리고 시간이 지나면 잦아든다.
// 노이즈는 서로 다른 주파수 사인의 합 (매끄럽고 할당 없음).
import { Vector3, type PerspectiveCamera } from 'three';
import { CAMERA } from '../config';

const offset = new Vector3();
const right = new Vector3();
const up = new Vector3();

export class CameraShake {
  trauma = 0;
  private time = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.shakeDecay * dt);
  }

  /** 지금 세기 (0~1) = trauma² */
  get intensity(): number {
    return this.trauma * this.trauma;
  }

  /** 카메라 자세에 흔들림 오프셋을 얹는다 */
  apply(camera: PerspectiveCamera): void {
    const k = this.intensity;
    if (k <= 0) return;
    const w = this.time * CAMERA.shakeFrequency * 2 * Math.PI;
    const ox = noise(w, 0) * CAMERA.shakeMaxOffset * k;
    const oy = noise(w, 1.7) * CAMERA.shakeMaxOffset * k;
    const roll = noise(w, 3.1) * CAMERA.shakeMaxRoll * k;
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    offset.copy(right).multiplyScalar(ox).addScaledVector(up, oy);
    camera.position.add(offset);
    camera.rotateZ(roll);
  }
}

/** [-1, 1] 근처의 매끄러운 의사 노이즈 */
function noise(w: number, phase: number): number {
  return (Math.sin(w + phase) + 0.5 * Math.sin(2.31 * w + phase * 1.9)) / 1.5;
}
