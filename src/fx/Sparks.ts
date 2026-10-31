// 시각 전용 부스러기 (물리 없음) + 폭발 섬광.
//
// 부스러기: 저폴리 돌멩이 하나를 인스턴스로 수천 개. 탄도는 정점 셰이더가 시각(uTime)만으로 계산한다.
//   떨어지는 동안 p = p0 + v·t - ½g·t², 땅에 닿으면 한 번 튀고(restitution) 그 자리에 멈춘다.
//   회전은 난수 축으로 멈출 때까지. 수명 끝에 작아지며 사라진다.
//   재질은 MeshStandardMaterial에 위 변환만 끼워 넣어 조명·그림자 받기·안개를 그대로 쓴다.
// 섬광: 폭발 지점의 짧은 점광 + HDR(밝기 > 1) 가산 스프라이트 → Bloom이 번지게 한다.
import {
  AdditiveBlending,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Scene,
} from 'three';
import { CONCRETE, SHARDS, type QualityPreset } from '../config';
import { createRng } from '../fracture/seeds';
import type { Vec3Like } from '../fracture/polyhedron';
import { randomDirection } from './Dust';
import { instancedGeometry, ParticleRing } from './ParticleRing';
import { createPuffTexture } from './puffTexture';
import { XRAY_ACTIVE, XRAY_HIDE } from './XRayView';

const ROCK_SEED = 77;
const ROCK_JITTER = 0.35; // 정이십면체 정점을 이 비율만큼 흔들어 불규칙한 돌멩이로

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform float uGravity;
uniform float uRestitution;
uniform float uShrinkSec;
attribute vec3 aStart;
attribute vec3 aVelocity;
attribute vec4 aParams; // 생성 시각, 수명, 크기, 난수 (회전 축·속도)

mat3 shardRotation( vec3 axis, float angle ) {
  float c = cos( angle );
  float s = sin( angle );
  float t = 1.0 - c;
  return mat3(
    t * axis.x * axis.x + c, t * axis.x * axis.y + s * axis.z, t * axis.x * axis.z - s * axis.y,
    t * axis.x * axis.y - s * axis.z, t * axis.y * axis.y + c, t * axis.y * axis.z + s * axis.x,
    t * axis.x * axis.z + s * axis.y, t * axis.y * axis.z - s * axis.x, t * axis.z * axis.z + c
  );
}`;

// beginnormal_vertex 자리에서 위치·회전을 다 계산해 두고 begin_vertex에서 쓴다
const VERTEX_MOTION = /* glsl */ `
float shardAge = uTime - aParams.x;
float shardSize = aParams.z;
if ( shardAge < 0.0 || shardAge > aParams.y ) shardSize = 0.0;
shardSize *= clamp( ( aParams.y - shardAge ) / uShrinkSec, 0.0, 1.0 );
float g = uGravity;
float rest = aParams.z * 0.5;
float h = max( aStart.y - rest, 0.0 );
float tLand = ( aVelocity.y + sqrt( aVelocity.y * aVelocity.y + 2.0 * g * h ) ) / g;
vec3 shardCenter;
float tStop = tLand;
if ( shardAge < tLand ) {
  shardCenter = aStart + aVelocity * shardAge;
  shardCenter.y -= 0.5 * g * shardAge * shardAge;
} else {
  float vy = ( g * tLand - aVelocity.y ) * uRestitution; // 튀어 오르는 속도
  float tBounce = 2.0 * vy / g;
  tStop = tLand + tBounce;
  float b = min( shardAge - tLand, tBounce );
  shardCenter = aStart + aVelocity * tLand;
  shardCenter.y = rest + vy * b - 0.5 * g * b * b;
  shardCenter.xz += aVelocity.xz * uRestitution * b;
}
float seed = aParams.w;
vec3 shardAxis = normalize( vec3( sin( seed * 91.7 ), cos( seed * 47.3 ), sin( seed * 13.1 + 1.0 ) ) );
mat3 shardRot = shardRotation( shardAxis, min( shardAge, tStop ) * ( 2.0 + seed * SHARD_SPIN ) );
vec3 objectNormal = shardRot * vec3( normal );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif`;

const VERTEX_POSITION = /* glsl */ `
vec3 transformed = shardRot * position * shardSize + shardCenter;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`;

const direction = new Vector3();

class Shards {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  private readonly ring: ParticleRing;
  private readonly start: InstancedBufferAttribute;
  private readonly velocity: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly uTime = { value: 0 };
  private readonly concrete = new Color(SHARDS.color);
  private readonly glass = new Color(SHARDS.glassColor);
  private time = 0;

  constructor(scene: Scene, capacity: number) {
    this.ring = new ParticleRing(capacity);
    const geometry = instancedGeometry(createRockGeometry(), capacity);
    this.start = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.velocity = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-1e9), 4);
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    geometry.setAttribute('aStart', this.start);
    geometry.setAttribute('aVelocity', this.velocity);
    geometry.setAttribute('aParams', this.params);
    geometry.setAttribute('color', this.color); // 인스턴스 색 (콘크리트 / 유리)

    const material = new MeshStandardMaterial({
      roughness: CONCRETE.interiorRoughness,
      vertexColors: true,
      flatShading: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uGravity = { value: SHARDS.gravity };
      shader.uniforms.uRestitution = { value: SHARDS.restitution };
      shader.uniforms.uShrinkSec = { value: SHARDS.shrinkSec };
      shader.defines = { ...shader.defines, SHARD_SPIN: SHARDS.spin.toFixed(1) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', VERTEX_MOTION)
        .replace('#include <begin_vertex>', VERTEX_POSITION);
    };
    material.customProgramCacheKey = () => 'shards';
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.userData[XRAY_HIDE] = true;
    scene.add(this.mesh);
  }

  /** 폭발: 반경에 비례한 수를 사방(위로 치우쳐)으로 */
  blast(center: Vec3Like, radius: number): void {
    const count = Math.min(Math.round(SHARDS.blastPerMeter * radius), this.ring.capacity / 4);
    for (let i = 0; i < count; i++) {
      randomDirection(direction);
      direction.y += SHARDS.upwardBias;
      direction.normalize().multiplyScalar(SHARDS.blastSpeed * (0.3 + 0.7 * Math.random()));
      this.emit(center, radius * 0.3, direction, this.concrete);
    }
  }

  /** 떨어진 조각이 땅에 부딪힘: 옆으로 튀는 소량 */
  groundImpact(point: Vec3Like): void {
    for (let i = 0; i < SHARDS.groundPerImpact; i++) {
      const a = Math.random() * Math.PI * 2;
      direction
        .set(Math.cos(a), 0.6 + Math.random(), Math.sin(a))
        .multiplyScalar(SHARDS.groundSpeed * (0.3 + 0.7 * Math.random()));
      this.emit(point, 0.2, direction, this.concrete);
    }
  }

  /** 내구도로 버틴 타격: 표면에서 튀는 작은 칩 */
  chips(point: Vec3Like, count: number): void {
    for (let i = 0; i < count; i++) {
      randomDirection(direction);
      direction.y = Math.abs(direction.y) * 0.5 + 0.3;
      direction.multiplyScalar(SHARDS.groundSpeed * (0.4 + 0.6 * Math.random()));
      this.emit(point, 0.15, direction, this.concrete);
    }
  }

  /** 유리 조각이 떨어져 나감: 유리색 반짝이 */
  glassBroken(point: Vec3Like): void {
    for (let i = 0; i < SHARDS.glassPerFragment; i++) {
      randomDirection(direction).multiplyScalar(SHARDS.groundSpeed * Math.random());
      this.emit(point, 0.1, direction, this.glass);
    }
  }

  update(time: number): void {
    this.time = time;
    this.uTime.value = time;
    this.ring.flush([this.start, this.velocity, this.params, this.color]);
  }

  clear(): void {
    this.params.array.fill(-1e9);
    this.params.clearUpdateRanges();
    this.params.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private emit(center: Vec3Like, spread: number, velocity: Vector3, color: Color): void {
    const i = this.ring.allocate();
    const r = spread * Math.random();
    this.start.setXYZ(
      i,
      center.x + (Math.random() - 0.5) * r,
      center.y + (Math.random() - 0.5) * r,
      center.z + (Math.random() - 0.5) * r,
    );
    this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
    const size = SHARDS.sizeMin + (SHARDS.sizeMax - SHARDS.sizeMin) * Math.random() ** 2;
    this.params.setXYZW(
      i,
      this.time,
      SHARDS.lifeSec * (0.6 + 0.4 * Math.random()),
      size,
      Math.random(),
    );
    const shade = 0.8 + 0.4 * Math.random();
    this.color.setXYZ(i, color.r * shade, color.g * shade, color.b * shade);
  }
}

/** 지름 1의 불규칙한 저폴리 돌멩이 (면마다 평평한 음영) */
function createRockGeometry(): IcosahedronGeometry {
  const g = new IcosahedronGeometry(0.5, 0);
  const rng = createRng(ROCK_SEED);
  const pos = g.getAttribute('position');
  // non-indexed라 같은 꼭짓점이 여러 번 나온다 → 좌표로 묶어 같은 양만큼 흔든다 (틈이 안 생기게)
  const offsets = new Map<string, number>();
  for (let k = 0; k < pos.count; k++) {
    const key = `${pos.getX(k).toFixed(4)},${pos.getY(k).toFixed(4)},${pos.getZ(k).toFixed(4)}`;
    let s = offsets.get(key);
    if (s === undefined) {
      s = 1 + (rng() * 2 - 1) * ROCK_JITTER;
      offsets.set(key, s);
    }
    pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) * s * 0.7, pos.getZ(k) * s);
  }
  g.computeVertexNormals();
  return g;
}

/** 폭발 섬광: 점광 + 가산 스프라이트가 flashSec 동안 꺼진다 (엑스레이 화면에선 안 보인다) */
class Flash {
  private readonly light: PointLight;
  private readonly ball: Sprite;
  private startTime = -Infinity;

  constructor(private readonly scene: Scene) {
    this.light = new PointLight(SHARDS.flashColor, 0, SHARDS.flashLightDistance);
    this.light.visible = false;
    this.ball = new Sprite(
      new SpriteMaterial({
        map: createPuffTexture(),
        color: new Color(SHARDS.flashColor).multiplyScalar(SHARDS.flashBrightness),
        blending: AdditiveBlending,
        depthTest: false, // 섬광 중심이 벽 표면이라 깊이 비교하면 반쪽이 잘린다
        depthWrite: false,
        fog: false,
      }),
    );
    this.ball.visible = false;
    scene.add(this.light, this.ball);
  }

  trigger(center: Vec3Like, radius: number, time: number): void {
    this.startTime = time;
    this.light.position.set(center.x, center.y, center.z);
    this.ball.position.copy(this.light.position);
    this.ball.scale.setScalar(radius * SHARDS.flashSizePerRadius);
  }

  update(time: number): void {
    const t = (time - this.startTime) / SHARDS.flashSec;
    const on = t >= 0 && t < 1 && !this.scene.userData[XRAY_ACTIVE];
    this.light.visible = on;
    this.ball.visible = on;
    if (!on) return;
    const k = (1 - t) * (1 - t);
    this.light.intensity = SHARDS.flashLightIntensity * k;
    this.ball.material.opacity = k;
  }

  dispose(): void {
    this.light.removeFromParent();
    this.ball.removeFromParent();
    this.ball.material.map?.dispose();
    this.ball.material.dispose();
  }
}

/** 부스러기 + 섬광. 풀 크기는 품질 프리셋을 따른다 */
export class Sparks {
  private shards: Shards;
  private readonly flash: Flash;
  private quality: QualityPreset;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    quality: QualityPreset,
  ) {
    this.quality = quality;
    this.shards = new Shards(scene, SHARDS.maxShards[quality]);
    this.flash = new Flash(scene);
  }

  /** 품질 프리셋이 바뀌면 풀을 새로 만든다 */
  setQuality(quality: QualityPreset): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.shards.dispose();
    this.shards = new Shards(this.scene, SHARDS.maxShards[quality]);
    this.shards.update(this.time);
  }

  blast(center: Vec3Like, radius: number): void {
    this.shards.blast(center, radius);
    this.flash.trigger(center, radius, this.time);
  }

  groundImpact(point: Vec3Like): void {
    this.shards.groundImpact(point);
  }

  glassBroken(point: Vec3Like): void {
    this.shards.glassBroken(point);
  }

  chips(point: Vec3Like, count: number): void {
    this.shards.chips(point, count);
  }

  /** time: 물리 시간 */
  update(time: number): void {
    this.time = time;
    this.shards.update(time);
    this.flash.update(time);
  }

  clear(): void {
    this.shards.clear();
  }

  dispose(): void {
    this.shards.dispose();
    this.flash.dispose();
  }
}
