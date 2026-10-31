// 완파 피날레 GPU 파편: 물리로 떨어뜨리지 않는 조각들을 같은 자리·크기·색의 돌덩이 파편으로 대체해 터뜨린다.
// 인스턴스 드로우콜 1개. 정점 셰이더가 시각만으로 탄도(중력)·지면 걸림·자전·수명 끝 축소를 계산한다
// (Dust와 같은 방식: CPU는 emit 때 칸만 쓴다). 시계는 물리 시간이라 슬로모션을 따른다.
import {
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Scene,
} from 'three';
import { FINALE, LIGHTING, PHYSICS } from '../config';
import type { Vec3Like } from '../fracture/polyhedron';
import { instancedGeometry, ParticleRing } from './ParticleRing';
import { XRAY_HIDE } from './XRayView';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uGravity;
attribute vec3 aStart;
attribute vec3 aVelocity;
attribute vec4 aParams; // 생성 시각, 크기, 회전 난수, 수명
attribute vec3 aColor;
varying vec3 vColor;
varying vec3 vNormalW;
#include <common>
#include <fog_pars_vertex>
mat3 kRotation( vec3 axis, float angle ) {
  float s = sin( angle );
  float c = cos( angle );
  float oc = 1.0 - c;
  return mat3(
    oc * axis.x * axis.x + c, oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
    oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c, oc * axis.y * axis.z + axis.x * s,
    oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c );
}
void main() {
  float age = uTime - aParams.x;
  float t = age / aParams.w;
  if ( age < 0.0 || t >= 1.0 ) {
    gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
    return;
  }
  float size = aParams.y * ( 1.0 - smoothstep( 0.75, 1.0, t ) );
  vec3 center = aStart + aVelocity * age;
  center.y += 0.5 * uGravity * age * age;
  // 지면에 닿으면 멈춘 자리에 눕는다 (튕김 없이 단순하게)
  float ground = size * 0.4;
  float landed = step( center.y, ground );
  center.y = max( center.y, ground );
  vec3 axis = normalize( vec3( aParams.z - 0.5, 0.6, fract( aParams.z * 7.13 ) - 0.5 ) );
  float spin = ( 2.0 + 6.0 * aParams.z ) * age * ( 1.0 - 0.8 * landed );
  mat3 r = kRotation( axis, spin + aParams.z * 6.2832 );
  vec3 world = center + r * ( position * size );
  vNormalW = r * normal;
  vColor = aColor;
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vColor;
varying vec3 vNormalW;
#include <common>
#include <fog_pars_fragment>
void main() {
  float light = 0.45 + 0.55 * max( dot( normalize( vNormalW ), uSunDir ), 0.0 );
  gl_FragColor = vec4( vColor * light, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const ROCK_DETAIL = 0;
const ROCK_JITTER = 0.25;
const v = new Vector3();

/** 울퉁불퉁한 저폴리 돌 (지름 1) */
function rockGeometry(): IcosahedronGeometry {
  const g = new IcosahedronGeometry(0.5, ROCK_DETAIL);
  const pos = g.getAttribute('position') as BufferAttribute;
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = jitter.get(key);
    if (k === undefined) {
      k = 1 + ROCK_JITTER * (Math.sin(i * 91.7 + v.x * 13.1) * 0.5);
      jitter.set(key, k);
    }
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class FinaleBurst {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly ring: ParticleRing;
  private readonly start: InstancedBufferAttribute;
  private readonly velocity: InstancedBufferAttribute;
  private readonly params: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private time = 0;
  /** 지금까지 낸 파편 수 (통계·측정) */
  emitted = 0;

  constructor(scene: Scene, capacity: number = FINALE.particleMax) {
    this.ring = new ParticleRing(capacity);
    const geometry = instancedGeometry(rockGeometry(), capacity);
    this.start = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.velocity = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.params = new InstancedBufferAttribute(new Float32Array(capacity * 4).fill(-1e9), 4);
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    geometry.setAttribute('aStart', this.start);
    geometry.setAttribute('aVelocity', this.velocity);
    geometry.setAttribute('aParams', this.params);
    geometry.setAttribute('aColor', this.color);
    const sun = new Vector3(
      LIGHTING.sunDirection.x,
      LIGHTING.sunDirection.y,
      LIGHTING.sunDirection.z,
    ).normalize();
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uGravity: { value: PHYSICS.gravity.y },
          uSunDir: { value: sun },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      fog: true,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false; // 인스턴스가 셰이더에서 움직인다
    this.mesh.castShadow = false;
    this.mesh.userData[XRAY_HIDE] = true;
    scene.add(this.mesh);
  }

  /** 파편 하나: 위치, 속도, 크기(지름 m), 색 */
  emit(at: Vec3Like, velocity: Vec3Like, size: number, color: Color): void {
    const i = this.ring.allocate();
    this.start.setXYZ(i, at.x, at.y, at.z);
    this.velocity.setXYZ(i, velocity.x, velocity.y, velocity.z);
    this.params.setXYZW(
      i,
      this.time,
      size,
      Math.random(),
      FINALE.particleLifeSec * (0.8 + 0.4 * Math.random()),
    );
    this.color.setXYZ(i, color.r, color.g, color.b);
    this.emitted++;
  }

  /** time: 물리 시간 */
  update(time: number): void {
    this.time = time;
    this.mesh.material.uniforms.uTime!.value = time;
    this.ring.flush([this.start, this.velocity, this.params, this.color]);
  }

  clear(): void {
    this.params.array.fill(-1e9);
    this.params.clearUpdateRanges();
    this.params.needsUpdate = true;
    this.emitted = 0;
  }
}
