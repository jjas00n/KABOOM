// 포인트 라이트 풀: 시작할 때 LIGHT_POOL.size개를 한 번만 만들어 씬에 계속 둔다.
// 꺼진 라이트는 세기 0. three는 씬의 라이트 수가 바뀌면 모든 재질 셰이더를 다시 컴파일하므로
// (화면이 수백 ms 멈춘다) 발사·화재 때마다 라이트를 만들거나 지우지 않는다.
// 그림자는 없다 (포인트 라이트 그림자는 큐브맵 6장이라 비싸다).
import { PointLight, type Scene } from 'three';
import { LIGHT_POOL } from '../config';

export class LightPool {
  private readonly lights: PointLight[] = [];
  private readonly used: boolean[] = [];

  constructor(scene: Scene, size: number = LIGHT_POOL.size) {
    for (let i = 0; i < size; i++) {
      const light = new PointLight(0xffffff, 0);
      light.castShadow = false;
      scene.add(light);
      this.lights.push(light);
      this.used.push(false);
    }
  }

  /** 빈 라이트 하나 (세기 0 상태). 남은 게 없으면 null */
  acquire(): PointLight | null {
    const i = this.used.indexOf(false);
    if (i < 0) return null;
    this.used[i] = true;
    return this.lights[i]!;
  }

  /** 돌려준다 (세기 0으로 끈다) */
  release(light: PointLight | null): void {
    if (!light) return;
    const i = this.lights.indexOf(light);
    if (i < 0) return;
    light.intensity = 0;
    this.used[i] = false;
  }

  get inUse(): number {
    return this.used.filter(Boolean).length;
  }
}
