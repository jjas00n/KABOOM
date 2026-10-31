// 파괴 이펙트 묶음: 먼지(Dust) + 부스러기·섬광(Sparks) + 불(Fire).
// 파티클 시계는 물리 시간(실제 시간 × timeScale)이라 hit-stop·킬캠 슬로모션에서 같이 느려진다.
import type { Scene } from 'three';
import { DURABILITY, DUST, type QualityPreset } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { Dust } from './Dust';
import { Fire } from './Fire';
import { FinaleBurst } from './FinaleBurst';
import { Sparks } from './Sparks';

export class Effects {
  readonly dust: Dust;
  readonly sparks: Sparks;
  readonly fire: Fire;
  /** 완파 피날레 GPU 파편 */
  readonly burst: FinaleBurst;
  /** 물리 시간 (s) */
  private time = 0;
  /** 이번 프레임에 일으킨 지면 충돌 이펙트 수 (상한 DUST.maxGroundImpactsPerFrame) */
  private groundEmits = 0;

  constructor(scene: Scene, quality: QualityPreset) {
    this.dust = new Dust(scene);
    this.sparks = new Sparks(scene, quality);
    this.fire = new Fire(scene);
    this.burst = new FinaleBurst(scene);
  }

  setQuality(quality: QualityPreset): void {
    this.sparks.setQuality(quality);
  }

  /** 폭발 (반경 m) */
  blast(center: Vec3Like, radius: number): void {
    this.dust.blast(center, radius);
    this.sparks.blast(center, radius);
  }

  /** 화염 폭발: 불꽃 구름 + 섬광, 먼지·부스러기는 조금만 */
  fireBlast(center: Vec3Like, radius: number): void {
    this.fire.burst(center, radius);
    this.sparks.blast(center, radius * 0.35);
    this.dust.blast(center, radius * 0.25);
  }

  /** 떨어진 조각이 지면에 부딪힘. speed: 충돌 직전 속력 (m/s), mass: kg */
  groundImpact(point: Vec3Like, speed: number, mass: number): void {
    if (speed < DUST.minImpactSpeed || this.groundEmits >= DUST.maxGroundImpactsPerFrame) return;
    this.groundEmits++;
    this.dust.groundImpact(point, mass);
    this.sparks.groundImpact(point);
  }

  /** 조각이 내구도로 버팀: 칩 + 작은 돌가루 */
  durabilityHit(point: Vec3Like): void {
    this.sparks.chips(point, DURABILITY.chipsPerHit);
    this.dust.puff(point, DUST.groundSize * 0.7);
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
    this.fire.update(this.time);
    this.burst.update(this.time);
  }

  /** 건물 재생성: 남은 파티클을 없앤다 */
  clear(): void {
    this.dust.clear();
    this.sparks.clear();
    this.fire.clear();
    this.burst.clear();
  }
}
