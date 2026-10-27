// 파괴 이펙트 묶음: 먼지(Dust) + 부스러기·섬광(Sparks).
// 파티클 시계는 물리 시간(실제 시간 × timeScale)이라 hit-stop·킬캠 슬로모션에서 같이 느려진다.
import type { Scene } from 'three';
import { DUST, type QualityPreset } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { Dust } from './Dust';
import { Sparks } from './Sparks';

export class Effects {
  readonly dust: Dust;
  readonly sparks: Sparks;
  /** 물리 시간 (s) */
  private time = 0;
  /** 이번 프레임에 일으킨 지면 충돌 이펙트 수 (상한 DUST.maxGroundImpactsPerFrame) */
  private groundEmits = 0;

  constructor(scene: Scene, quality: QualityPreset) {
    this.dust = new Dust(scene);
    this.sparks = new Sparks(scene, quality);
  }

  setQuality(quality: QualityPreset): void {
    this.sparks.setQuality(quality);
  }

  /** 폭발 (반경 m) */
  blast(center: Vec3Like, radius: number): void {
    this.dust.blast(center, radius);
    this.sparks.blast(center, radius);
  }

  /** 떨어진 조각이 지면에 부딪힘. speed: 충돌 직전 속력 (m/s), mass: kg */
  groundImpact(point: Vec3Like, speed: number, mass: number): void {
    if (speed < DUST.minImpactSpeed || this.groundEmits >= DUST.maxGroundImpactsPerFrame) return;
    this.groundEmits++;
    this.dust.groundImpact(point, mass);
    this.sparks.groundImpact(point);
  }

  glassBroken(point: Vec3Like): void {
    this.sparks.glassBroken(point);
  }

  /** 렌더 프레임마다. physicsDt = 실제 경과 시간 × timeScale */
  update(physicsDt: number): void {
    this.time += physicsDt;
    this.groundEmits = 0;
    this.dust.update(this.time);
    this.sparks.update(this.time);
  }

  /** 건물 재생성: 남은 파티클을 없앤다 */
  clear(): void {
    this.dust.clear();
    this.sparks.clear();
  }
}
