// 파이어볼 모양: 밝은 코어(HDR → Bloom) + 바깥 불꽃 셸.
// 셸은 3D 값 노이즈로 정점을 일렁이고 가산 블렌딩한다. 가장자리(시선과 비스듬한 면)일수록 붉고 옅게.
// 꼬리 불꽃·연기는 Fire 파티클 풀이 따로 뿜는다 (Game). 지팡이 충전 구슬도 같은 클래스를 쓴다.
import {
  AdditiveBlending,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
} from 'three';
import { FIREBALL } from '../config';
import { NOISE_GLSL } from './noise';
import { XRAY_HIDE } from './XRayView';

const CORE_DETAIL = 3;
const SHELL_DETAIL = 4;

const SHELL_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uDisplace;
varying float vNoise;
varying float vFacing;
${NOISE_GLSL}
void main() {
  vec3 n = normalize( position );
  // 위쪽으로 흐르는 노이즈 → 불꽃이 위로 너울대는 느낌
  float k = kFbm( n * uNoiseScale + vec3( 0.0, -uTime * uNoiseSpeed, uTime * 0.37 ) );
  vNoise = k;
  vec3 p = position * ( 1.0 + uDisplace * ( k - 0.35 ) );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  vec3 viewNormal = normalize( normalMatrix * n );
  vFacing = abs( dot( viewNormal, normalize( -mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`;

const SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uBrightness;
uniform float uOpacity;
varying float vNoise;
varying float vFacing;
void main() {
  float heat = clamp( vFacing * 0.8 + vNoise * 0.6 - 0.2, 0.0, 1.0 );
  vec3 color = mix( uOuter, uInner, heat ) * uBrightness;
  float alpha = smoothstep( 0.05, 0.6, vFacing ) * ( 0.35 + 0.65 * vNoise ) * uOpacity;
  gl_FragColor = vec4( color, alpha ); // AdditiveBlending: SrcAlpha × 색
}`;

export class FireballVisual {
  readonly root = new Group();
  private readonly shellMaterial: ShaderMaterial;
  private readonly coreMaterial: MeshBasicMaterial;

  constructor(radius: number = FIREBALL.radius) {
    this.coreMaterial = new MeshBasicMaterial({
      color: new Color(FIREBALL.coreColor).multiplyScalar(FIREBALL.coreBrightness),
      toneMapped: false,
    });
    const core = new Mesh(new IcosahedronGeometry(radius * 0.7, CORE_DETAIL), this.coreMaterial);
    this.shellMaterial = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNoiseScale: { value: FIREBALL.shellNoiseScale },
        uNoiseSpeed: { value: FIREBALL.shellNoiseSpeed },
        uDisplace: { value: FIREBALL.shellDisplace },
        uInner: { value: new Color(FIREBALL.coreColor) },
        uOuter: { value: new Color(FIREBALL.shellColor) },
        uBrightness: { value: FIREBALL.shellBrightness },
        uOpacity: { value: 1 },
      },
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    const shell = new Mesh(
      new IcosahedronGeometry(radius * FIREBALL.shellScale, SHELL_DETAIL),
      this.shellMaterial,
    );
    shell.renderOrder = 2;
    this.root.add(core, shell);
    this.root.userData[XRAY_HIDE] = true;
  }

  /** 렌더 프레임마다. time: 누적 시간 (s) */
  update(time: number): void {
    this.shellMaterial.uniforms.uTime!.value = time;
  }

  /** 셸 불투명도 (충전 중 서서히) */
  set opacity(v: number) {
    this.shellMaterial.uniforms.uOpacity!.value = v;
  }
}
