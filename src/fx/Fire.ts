// 불 파티클: 불꽃(가산) · 연기(일반) · 불씨(가산) 세 풀. 각각 인스턴스 드로우콜 1개.
// Dust와 같은 방식: 정점 셰이더가 시각(uTime)만으로 움직임을 계산하고, CPU는 emit 때 칸 몇 개만 쓴다.
//   위치 = 시작 + 속도 × (1 - e^{-drag·t}) / drag + 상승 × t²/2 (불꽃은 위로 가속)
//   크기 = 시작 × mix(1, growth, t), 색 = 시작색 → 끝색
// 조각마다 이미터를 두지 않는다: FireSystem이 틱마다 타는 조각 몇 개를 뽑아 여기서 방출한다.
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Blending,
  type Scene,
} from 'three';
import { FIRE } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { randomDirection } from './Dust';
import { instancedGeometry, ParticleRing } from './ParticleRing';
import { createPuffTexture } from './puffTexture';
import { XRAY_HIDE } from './XRayView';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uDrag;
uniform float uRise;
uniform float uGrowth;
attribute vec3 aStart;
attribute vec3 aVelocity;
attribute vec4 aParams; // 생성 시각, 수명, 시작 크기, 난수
varying vec2 vUv;
varying float vLife;
#include <common>
#include <fog_pars_vertex>
void main() {
  float age = uTime - aParams.x;
  float t = age / aParams.y;
  if ( t < 0.0 || t >= 1.0 ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
    return;
  }
  float size = aParams.z * mix( 1.0, uGrowth, t );
  vec3 center = aStart + aVelocity * ( ( 1.0 - exp( -uDrag * age ) ) / uDrag );
  center.y += 0.5 * uRise * age * age;
  center.y = max( center.y, size * 0.2 );
  vec4 mvPosition = modelViewMatrix * vec4( center, 1.0 );
  float angle = aParams.w * 6.2832 + age * ( aParams.w - 0.5 ) * 1.5;
  float c = cos( angle );
  float s = sin( angle );
  mvPosition.xy += mat2( c, s, -s, c ) * position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vLife = t;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColorStart;
uniform vec3 uColorEnd;
uniform float uOpacity;
varying vec2 vUv;
varying float vLife;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = texture2D( uMap, vUv ).a * uOpacity
    * smoothstep( 0.0, 0.08, vLife ) * ( 1.0 - vLife ) * ( 1.0 - vLife * 0.3 );
  if ( a < 0.002 ) discard;
  vec3 color = mix( uColorStart, uColorEnd, vLife );
  gl_FragColor = vec4( color, a ); // 가산 블렌딩도 SrcAlpha × 색
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

interface PoolOptions {
  capacity: number;
  drag: number;
  rise: number;
  growth: number;
  colorStart: Color;
  colorEnd: Color;
  opacity: number;
  blending: Blending;
}

/** 한 종류 파티클 풀 */
class FirePool {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly ring: ParticleRing;
  private readonly start: InstancedBufferAttribute;
  private readonly velocity: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  time = 0;

  constructor(scene: Scene, o: PoolOptions, map: ReturnType<typeof createPuffTexture>) {
    const n = o.capacity;
    this.ring = new ParticleRing(n);
    const geometry = instancedGeometry(new PlaneGeometry(1, 1), n);
    this.start = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.velocity = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.params = new InstancedBufferAttribute(new Float32Array(n * 4).fill(-1e9), 4);
    geometry.setAttribute('aStart', this.start);
    geometry.setAttribute('aVelocity', this.velocity);
    geometry.setAttribute('aParams', this.params);
    const additive = o.blending === AdditiveBlending;
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDrag: { value: o.drag },
          uRise: { value: o.rise },
          uGrowth: { value: o.growth },
          uMap: { value: null },
          uColorStart: { value: o.colorStart },
          uColorEnd: { value: o.colorEnd },
          uOpacity: { value: o.opacity },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: o.blending,
      fog: true,
    });
    material.uniforms.uMap!.value = map;
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 2 : 1;
    this.mesh.userData[XRAY_HIDE] = true;
    scene.add(this.mesh);
  }

  emit(p: Vec3Like, v: Vec3Like, life: number, size: number): void {
    const i = this.ring.allocate();
    this.start.setXYZ(i, p.x, p.y, p.z);
    this.velocity.setXYZ(i, v.x, v.y, v.z);
    this.params.setXYZW(i, this.time, life, size, Math.random());
  }

  update(time: number): void {
    this.time = time;
    this.mesh.material.uniforms.uTime!.value = time;
    this.ring.flush([this.start, this.velocity, this.params]);
  }

  clear(): void {
    this.params.array.fill(-1e9);
    this.params.clearUpdateRanges();
    this.params.needsUpdate = true;
  }
}

const EMBER_DRAG = 0.6;
const hdr = (color: number, brightness: number) => new Color(color).multiplyScalar(brightness);
const v = new Vector3();
const p = new Vector3();

export class Fire {
  private readonly flames: FirePool;
  private readonly smoke: FirePool;
  private readonly embers: FirePool;

  constructor(scene: Scene) {
    const map = createPuffTexture();
    this.flames = new FirePool(
      scene,
      {
        capacity: FIRE.maxFlames,
        drag: 2,
        rise: FIRE.flameRise,
        growth: 0.35, // 위로 올라가며 가늘어진다
        colorStart: hdr(0xffd27a, FIRE.flameBrightness),
        colorEnd: hdr(FIRE.flameColor, FIRE.flameBrightness * 0.5),
        opacity: 0.9,
        blending: AdditiveBlending,
      },
      map,
    );
    this.smoke = new FirePool(
      scene,
      {
        capacity: FIRE.maxSmoke,
        drag: 0.8,
        rise: FIRE.smokeRise * 0.15,
        growth: FIRE.smokeGrowth,
        colorStart: new Color(FIRE.smokeColor),
        colorEnd: new Color(FIRE.smokeColor).multiplyScalar(1.6),
        opacity: FIRE.smokeOpacity,
        blending: NormalBlending,
      },
      map,
    );
    this.embers = new FirePool(
      scene,
      {
        capacity: FIRE.maxEmbers,
        drag: EMBER_DRAG,
        rise: 0.6,
        growth: 0.3,
        colorStart: hdr(FIRE.emberColor, FIRE.emberBrightness),
        colorEnd: hdr(0xff3a10, FIRE.emberBrightness * 0.4),
        opacity: 1,
        blending: AdditiveBlending,
      },
      map,
    );
  }

  /** 타는 지점 하나에서 불꽃 (+가끔 연기). scale: 크기 배율 (0~1 heat 등) */
  flame(at: Vec3Like, scale = 1, withSmoke = false): void {
    for (let k = 0; k < FIRE.flamesPerEmitter; k++) {
      p.set(at.x + (Math.random() - 0.5) * 0.4, at.y, at.z + (Math.random() - 0.5) * 0.4);
      v.set((Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6);
      this.flames.emit(
        p,
        v,
        FIRE.flameLifeSec * (0.7 + 0.6 * Math.random()),
        FIRE.flameSize * scale * (0.7 + 0.6 * Math.random()),
      );
    }
    if (withSmoke) this.smokePuff(at, FIRE.smokeSize * scale);
    if (Math.random() < 0.3) this.ember(at, FIRE.emberSpeed);
  }

  /** 연기 한 덩이 (위로 올라가며 커진다) */
  smokePuff(at: Vec3Like, size: number, upSpeed: number = FIRE.smokeRise): void {
    v.set(
      (Math.random() - 0.5) * 0.8,
      upSpeed * (0.7 + 0.6 * Math.random()),
      (Math.random() - 0.5) * 0.8,
    );
    this.smoke.emit(at, v, FIRE.smokeLifeSec * (0.7 + 0.6 * Math.random()), size);
  }

  /** 불씨 하나: 사방으로 튀었다가 살짝 떠오른다 */
  ember(at: Vec3Like, speed: number): void {
    randomDirection(v);
    v.y = Math.abs(v.y) * 0.8 + 0.2;
    v.multiplyScalar(speed * (0.4 + 0.6 * Math.random()));
    this.embers.emit(at, v, FIRE.emberLifeSec * (0.6 + 0.8 * Math.random()), FIRE.emberSize);
  }

  /** 불씨가 점 at으로 빨려 들어간다 (마법사 충전·등장 소용돌이) */
  emberToward(at: Vec3Like, radius: number, life: number): void {
    randomDirection(v);
    p.copy(v).multiplyScalar(radius).add(at);
    // 출발점에서 at을 향해: 수명이 끝날 때 at에 닿는 속도 (이동 거리 = v(1 - e^{-drag·t}) / drag)
    v.multiplyScalar((-radius * EMBER_DRAG) / (1 - Math.exp(-EMBER_DRAG * life)));
    this.embers.emit(p, v, life, FIRE.emberSize * 1.2);
  }

  /** 파이어볼 꼬리: 지나간 자리에 짧은 불꽃 */
  trail(at: Vec3Like, size: number): void {
    v.set(
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 0.8 + 0.4,
      (Math.random() - 0.5) * 0.8,
    );
    this.flames.emit(at, v, FIRE.flameLifeSec * 0.6 * (0.6 + 0.8 * Math.random()), size);
  }

  /** 화염 폭발: 불꽃 구름 + 불씨 + 연기 */
  burst(at: Vec3Like, radius: number): void {
    for (let i = 0; i < 60; i++) {
      randomDirection(v);
      v.y = Math.abs(v.y) * 0.6;
      p.copy(v)
        .multiplyScalar(radius * 0.35 * Math.random())
        .add(at);
      v.multiplyScalar(radius * (0.6 + 0.8 * Math.random()));
      this.flames.emit(p, v, FIRE.flameLifeSec * (0.8 + 0.8 * Math.random()), FIRE.flameSize * 2.2);
    }
    for (let i = 0; i < 40; i++) this.ember(at, FIRE.emberSpeed * 4);
    for (let i = 0; i < 12; i++) {
      randomDirection(p)
        .multiplyScalar(radius * 0.4)
        .add(at);
      this.smokePuff(p, FIRE.smokeSize * 1.5, FIRE.smokeRise * 0.6);
    }
  }

  /** time: 물리 시간 */
  update(time: number): void {
    this.flames.update(time);
    this.smoke.update(time);
    this.embers.update(time);
  }

  clear(): void {
    this.flames.clear();
    this.smoke.clear();
    this.embers.clear();
  }
}
