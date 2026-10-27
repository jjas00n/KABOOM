// 먼지 구름 소프트 파티클: 카메라를 향한 쿼드 수백 개를 인스턴스 드로우콜 1개로.
// 움직임은 정점 셰이더가 시각(uTime)만으로 계산한다 → CPU는 emit 때 칸 몇 개만 쓴다.
//   위치 = 시작 + 속도 × (1 - e^{-drag·t}) / drag + 상승 × t   (공기 저항으로 금방 멈추고 떠오른다)
//   크기는 growth배까지 커지고, 알파는 빨리 나타났다가 서서히 옅어진다.
// '소프트': 텍스처 가장자리 감쇠 + 카메라 근처 페이드 (장면 깊이 비교는 하지 않는다).
import {
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
  type Scene,
} from 'three';
import { DUST } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { instancedGeometry, ParticleRing } from './ParticleRing';
import { createPuffTexture } from './puffTexture';
import { XRAY_HIDE } from './XRayView';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uDrag;
uniform float uRise;
uniform float uGrowth;
uniform float uNearFade;
uniform float uFadeExponent;
attribute vec3 aStart;
attribute vec3 aVelocity;
attribute vec4 aParams; // 생성 시각, 수명, 시작 크기, 난수
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <common>
#include <fog_pars_vertex>
void main() {
  float age = uTime - aParams.x;
  float t = age / aParams.y;
  if ( t < 0.0 || t >= 1.0 ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 ); // 클립 공간 밖 → 안 그림
    return;
  }
  float grow = 1.0 - ( 1.0 - t ) * ( 1.0 - t );
  float size = aParams.z * mix( 1.0, uGrowth, grow );
  vec3 center = aStart + aVelocity * ( ( 1.0 - exp( -uDrag * age ) ) / uDrag );
  center.y += uRise * age;
  center.y = max( center.y, size * 0.3 ); // 땅속으로 파고들지 않게
  vec4 mvPosition = modelViewMatrix * vec4( center, 1.0 );
  float angle = aParams.w * 6.2832 + age * ( aParams.w - 0.5 ) * 0.6;
  float c = cos( angle );
  float s = sin( angle );
  mvPosition.xy += mat2( c, s, -s, c ) * position.xy * size;
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vShade = position.y + 0.5; // 회전 전 위/아래 (위가 밝게)
  float fadeIn = smoothstep( 0.0, 0.06, t );
  float fadeOut = pow( 1.0 - t, uFadeExponent );
  vAlpha = fadeIn * fadeOut * smoothstep( 0.0, uNearFade, -mvPosition.z );
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLightTop;
uniform float uLightBottom;
varying vec2 vUv;
varying float vAlpha;
varying float vShade;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = texture2D( uMap, vUv ).a * vAlpha * uOpacity;
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( uColor * mix( uLightBottom, uLightTop, vShade ), a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const direction = new Vector3();

export class Dust {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly ring = new ParticleRing(DUST.maxPuffs);
  private readonly start: InstancedBufferAttribute;
  private readonly velocity: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private time = 0;

  constructor(scene: Scene) {
    const n = DUST.maxPuffs;
    const geometry = instancedGeometry(new PlaneGeometry(1, 1), n);
    this.start = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.velocity = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    // 생성 시각을 -∞로 두면 처음엔 전부 수명이 끝난 상태 (안 그림)
    this.params = new InstancedBufferAttribute(new Float32Array(n * 4).fill(-1e9), 4);
    geometry.setAttribute('aStart', this.start);
    geometry.setAttribute('aVelocity', this.velocity);
    geometry.setAttribute('aParams', this.params);

    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDrag: { value: DUST.drag },
          uRise: { value: DUST.rise },
          uGrowth: { value: DUST.growth },
          uNearFade: { value: DUST.nearFade },
          uFadeExponent: { value: DUST.fadeExponent },
          uMap: { value: null },
          uColor: { value: new Color(DUST.color) },
          uOpacity: { value: DUST.opacity },
          uLightTop: { value: DUST.lightTop },
          uLightBottom: { value: DUST.lightBottom },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    material.uniforms.uMap!.value = createPuffTexture();
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; // 인스턴스가 셰이더에서 움직인다
    this.mesh.renderOrder = 1; // 유리 등 다른 투명 물체 뒤에
    this.mesh.userData[XRAY_HIDE] = true;
    scene.add(this.mesh);
  }

  /** 폭발: 반경에 비례해 퍼프를 사방(위쪽으로 치우쳐)으로 */
  blast(center: Vec3Like, radius: number): void {
    const count = Math.min(Math.round(DUST.blastPuffsPerMeter * radius), DUST.maxPuffsPerBlast);
    for (let i = 0; i < count; i++) {
      randomDirection(direction);
      direction.y = Math.abs(direction.y) * 0.8 + 0.1;
      const spread = radius * 0.4 * Math.random();
      this.emit(
        center.x + direction.x * spread,
        center.y + direction.y * spread,
        center.z + direction.z * spread,
        direction.multiplyScalar(DUST.blastSpeed * (0.4 + 0.6 * Math.random())),
        DUST.blastLifeSec * (0.7 + 0.6 * Math.random()),
        DUST.blastSize * (0.7 + 0.6 * Math.random()),
      );
    }
  }

  /** 조각이 지면에 부딪힘: 땅에서 낮게 옆으로 퍼지는 작은 구름. mass: kg */
  groundImpact(point: Vec3Like, mass: number): void {
    const count = Math.min(
      1 + Math.floor((mass / 1000) * DUST.groundPuffsPerTonne),
      DUST.groundMaxPuffs,
    );
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      direction.set(Math.cos(a), 0.15 + 0.2 * Math.random(), Math.sin(a));
      this.emit(
        point.x,
        DUST.groundSize * 0.3,
        point.z,
        direction.multiplyScalar(DUST.groundSpeed * (0.5 + 0.5 * Math.random())),
        DUST.groundLifeSec * (0.7 + 0.6 * Math.random()),
        DUST.groundSize * (0.7 + 0.6 * Math.random()),
      );
    }
  }

  /** time: 물리 시간 (hit-stop·슬로모션을 따른다) */
  update(time: number): void {
    this.time = time;
    this.mesh.material.uniforms.uTime!.value = time;
    this.ring.flush([this.start, this.velocity, this.params]);
  }

  /** 떠 있는 먼지를 전부 없앤다 (건물 재생성) */
  clear(): void {
    this.params.array.fill(-1e9);
    this.params.clearUpdateRanges();
    this.params.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.uniforms.uMap!.value.dispose();
    this.mesh.material.dispose();
  }

  private emit(
    x: number,
    y: number,
    z: number,
    velocity: Vector3,
    life: number,
    size: number,
  ): void {
    const i = this.ring.allocate();
    this.start.setXYZ(i, x, y, z);
    this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
    this.params.setXYZW(i, this.time, life, size, Math.random());
  }
}

/** 단위 구 위의 균일 난수 방향 */
export function randomDirection(out: Vector3): Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}
