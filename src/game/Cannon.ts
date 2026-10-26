// 대포: 절차적 메시, 등장 애니메이션, 조준
// 슈퍼마리오64 대포 오마주 — 풀 언덕 꼭대기 검은 구멍에서 솟아오르는 검은 포신 + 받침.
// 메시·텍스처는 전부 코드로 만든다 (원작 에셋 사용 안 함).
//
// 계층: root(언덕 위, 건물을 향함) → riser(솟아오르기) → base, yawPivot(y축) → pitchPivot(x축) → barrel
// 조준 방향·포구 위치는 riser 애니메이션과 무관한 '다 솟은 자세' 기준 수식으로 계산한다
// (컷신 끝 자세, 예상 궤적, 실제 발사가 항상 같은 값을 쓰도록).
import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type Scene,
} from 'three';
import { CANNON } from '../config';
import { easeOutBack } from '../camera/easing';
import { aimDirection, clampAim } from './ballistics';

const LATHE_SEGMENTS = 40;
const HILL_PROFILE_STEPS = 24;

interface Puff {
  sprite: Sprite;
  velocity: Vector3;
  age: number;
}

export class Cannon {
  readonly root = new Group();
  /** 건물 쪽 기본 방위각 (+z 기준 y축 회전) */
  readonly baseYaw: number;
  yaw = 0;
  pitch: number = CANNON.startPitch;

  private readonly riser = new Group();
  private readonly yawPivot = new Group();
  private readonly pitchPivot = new Group();
  private readonly barrel: Mesh;
  /** 0 = 땅속, 1 = 다 솟음 */
  private riseT = 0;
  private rising = false;
  private recoil = 0;
  private readonly puffs: Puff[] = [];
  private readonly scratch = new Vector3();

  constructor(scene: Scene, buildingCenter: Vector3) {
    const { position, hillHeight } = CANNON;
    this.root.position.set(position.x, hillHeight, position.z);
    this.baseYaw = Math.atan2(buildingCenter.x - position.x, buildingCenter.z - position.z);
    this.root.rotation.y = this.baseYaw;

    scene.add(createHill(position.x, position.z));
    this.root.add(createHole(), this.riser);

    const metal = (color: number) =>
      new MeshStandardMaterial({ color, metalness: CANNON.metalness, roughness: CANNON.roughness });
    const base = new Mesh(
      new CylinderGeometry(
        CANNON.baseRadius * 0.85,
        CANNON.baseRadius,
        CANNON.baseHeight,
        LATHE_SEGMENTS,
      ),
      metal(CANNON.baseColor),
    );
    base.position.y = CANNON.baseHeight / 2;
    const trim = new Mesh(
      new CylinderGeometry(
        CANNON.baseRadius * 0.9,
        CANNON.baseRadius * 0.9,
        CANNON.trimHeight,
        LATHE_SEGMENTS,
      ),
      metal(CANNON.trimColor),
    );
    trim.position.y = CANNON.baseHeight + CANNON.trimHeight / 2;
    this.riser.add(base, trim, this.yawPivot);

    this.yawPivot.position.y = CANNON.pivotHeight;
    this.yawPivot.add(this.pitchPivot);
    this.barrel = new Mesh(createBarrelGeometry(), metal(CANNON.barrelColor));
    const bore = new Mesh(
      new CircleGeometry(CANNON.boreRadius, LATHE_SEGMENTS),
      new MeshStandardMaterial({ color: CANNON.holeColor, roughness: 1 }),
    );
    bore.position.z = CANNON.barrelLength - CANNON.boreRadius; // 포구 안쪽 어두운 바닥
    this.barrel.add(bore);
    this.pitchPivot.add(this.barrel);

    for (const m of [base, trim, this.barrel]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }

    const smokeMaterial = new SpriteMaterial({
      map: createSmokeTexture(),
      transparent: true,
      depthWrite: false,
    });
    for (let i = 0; i < CANNON.smokePuffs; i++) {
      const sprite = new Sprite(smokeMaterial.clone());
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, velocity: new Vector3(), age: Infinity });
    }

    this.lower();
    scene.add(this.root);
  }

  get risen(): boolean {
    return this.riseT >= 1;
  }

  /** 땅속으로 즉시 내린다 (다음 컷신에서 다시 솟아오르게) */
  lower(): void {
    this.riseT = 0;
    this.rising = false;
    this.applyPose();
  }

  /** 솟아오르기 시작 (이미 솟았으면 무시) */
  rise(): void {
    if (!this.risen) this.rising = true;
  }

  /** 등장 애니메이션 건너뛰기 */
  finishRise(): void {
    this.riseT = 1;
    this.rising = false;
    this.applyPose();
  }

  /** 각도 제한 안으로 조준 */
  setAim(yaw: number, pitch: number): void {
    const a = clampAim(yaw, pitch);
    this.yaw = a.yaw;
    this.pitch = a.pitch;
    this.applyPose();
  }

  /** 포신 회전축 (다 솟은 자세 기준, 월드) */
  pivotWorld(out: Vector3): Vector3 {
    return out.set(
      this.root.position.x,
      this.root.position.y + CANNON.pivotHeight,
      this.root.position.z,
    );
  }

  /** 조준 방향 단위 벡터 (월드) */
  aimDirection(out: Vector3): Vector3 {
    aimDirection(this.baseYaw, this.yaw, this.pitch, out);
    return out;
  }

  /** 포구 중심 (다 솟은 자세 기준, 월드) */
  muzzleWorld(out: Vector3): Vector3 {
    this.pivotWorld(out);
    return out.addScaledVector(this.aimDirection(this.scratch), CANNON.barrelLength);
  }

  /** 발사 연출: 반동 + 포연 */
  fire(): void {
    this.recoil = 1;
    const muzzle = this.muzzleWorld(new Vector3());
    const dir = this.aimDirection(new Vector3());
    for (const puff of this.puffs) {
      puff.age = 0;
      puff.sprite.visible = true;
      puff.sprite.position.copy(muzzle);
      const spread = 0.6;
      puff.velocity
        .copy(dir)
        .multiplyScalar(CANNON.smokeSpeed * (0.4 + Math.random() * 0.8))
        .add(
          this.scratch.set(
            (Math.random() - 0.5) * spread,
            Math.random() * spread,
            (Math.random() - 0.5) * spread,
          ),
        );
    }
  }

  update(dt: number): void {
    if (this.rising) {
      this.riseT = Math.min(1, this.riseT + dt / CANNON.riseSec);
      if (this.riseT >= 1) this.rising = false;
    }
    if (this.recoil > 0) this.recoil = Math.max(0, this.recoil - dt / CANNON.recoilReturnSec);
    this.applyPose();

    for (const puff of this.puffs) {
      if (!puff.sprite.visible) continue;
      puff.age += dt;
      const life = puff.age / CANNON.smokeLifeSec;
      if (life >= 1) {
        puff.sprite.visible = false;
        continue;
      }
      puff.sprite.position.addScaledVector(puff.velocity, dt);
      puff.velocity.multiplyScalar(Math.max(0, 1 - 2 * dt)); // 공기 저항
      puff.sprite.scale.setScalar(CANNON.smokeSize * (1 + 2 * life));
      puff.sprite.material.opacity = 0.7 * (1 - life);
    }
  }

  private applyPose(): void {
    this.riser.position.y = -CANNON.riseDepth * (1 - easeOutBack(this.riseT));
    this.riser.visible = this.riseT > 0 || this.rising;
    this.yawPivot.rotation.y = this.yaw;
    this.pitchPivot.rotation.x = -this.pitch;
    // 반동: 포신이 뒤로 밀렸다가 돌아온다 (빠르게 밀리고 천천히 복귀)
    this.barrel.position.z = -CANNON.recoilDistance * this.recoil * this.recoil;
  }
}

/** 포신: 뒤쪽 둥근 약실 → 원통 → 벌어진 포구 테두리 → 안쪽 구멍. +Z 방향으로 놓인다. */
function createBarrelGeometry(): LatheGeometry {
  const {
    barrelLength: L,
    barrelRadius: r,
    breechRadius: rb,
    muzzleFlare: rf,
    boreRadius: ri,
  } = CANNON;
  const pts: Vector2[] = [];
  // 약실 반구 (회전축 뒤쪽)
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new Vector2(Math.sin(a) * rb, -Math.cos(a) * rb));
  }
  pts.push(new Vector2(r, rb * 0.9));
  pts.push(new Vector2(r * 0.92, L - 0.9));
  pts.push(new Vector2(rf, L - 0.25)); // 포구 테두리
  pts.push(new Vector2(rf, L));
  pts.push(new Vector2(ri, L));
  pts.push(new Vector2(ri, L - ri)); // 구멍 안쪽 벽 (바닥은 bore 원판)
  const geo = new LatheGeometry(pts, LATHE_SEGMENTS);
  geo.rotateX(Math.PI / 2); // 축 +Y → +Z
  return geo;
}

/** 꼭대기가 평평한 풀 언덕 (평평한 반경 = 구멍 + 여유) */
function createHill(x: number, z: number): Mesh {
  const { hillRadius: R, hillHeight: H, holeRadius } = CANNON;
  const flat = holeRadius + 1;
  const pts: Vector2[] = [];
  for (let i = 0; i <= HILL_PROFILE_STEPS; i++) {
    const r = flat + ((R - flat) * i) / HILL_PROFILE_STEPS;
    const s = Math.cos((((r - flat) / (R - flat)) * Math.PI) / 2);
    pts.push(new Vector2(r, H * s * s));
  }
  pts.unshift(new Vector2(0, H));
  const hill = new Mesh(
    new LatheGeometry(pts.reverse(), LATHE_SEGMENTS * 2),
    new MeshStandardMaterial({ color: CANNON.hillColor, roughness: 1 }),
  );
  hill.position.set(x, 0, z);
  hill.receiveShadow = true;
  hill.castShadow = true;
  return hill;
}

/** 대포가 나오는 검은 구멍 (언덕 꼭대기에 살짝 띄운 원판) */
function createHole(): Mesh {
  const hole = new Mesh(
    new CircleGeometry(CANNON.holeRadius, LATHE_SEGMENTS),
    new MeshStandardMaterial({ color: CANNON.holeColor, roughness: 1 }),
  );
  hole.rotation.x = -Math.PI / 2;
  hole.position.y = 0.02;
  return hole;
}

/** 포연 스프라이트 텍스처: 가운데가 진한 회색 원형 그라디언트 */
function createSmokeTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(200,200,200,1)');
  g.addColorStop(0.5, 'rgba(160,160,160,0.6)');
  g.addColorStop(1, 'rgba(140,140,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}
