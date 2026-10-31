// 조각 렌더: 재질별 BatchedMesh (콘크리트 외면 / 콘크리트 단면 / 유리) → 드로우콜 최대 3개
// 외면: 부재 기준 박스 투영 UV (Fragment.ts). 단면: 조각 원래 자리 좌표(rest)로 트라이플래너.
// 인스턴스 색(RGBA) = 조각별 기본색(tint). 화재가 RGB를 그을음으로 어둡게 하고, 알파로 불씨 세기를 넘긴다
// (알파 = 1 - 불씨). 불투명 재질이라 알파는 원래 안 쓰이고, 엑스레이(투명) 중에는 불씨 해석을 끈다.
// 손상 외관: 배치마다 인스턴스 id로 읽는 DataTexture(R = damage, G = 매달림, B = 흔들림 위상).
//   외부면은 폴리곤 중심 팬으로 다시 삼각화하고 rim 속성(경계 1, 중심 0)을 붙여 경계에 균열을 그린다.
//   재질·드로우콜은 늘지 않는다.
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  FloatType,
  Matrix4,
  RGBAFormat,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector4,
  type Material,
} from 'three';
import { CONCRETE, DAMAGE_VISUAL, FIRE, GLASS, TEXTURES, type GlassMode } from '../config';
import { NOISE_GLSL } from '../fx/noise';
import type { Assets } from '../core/Assets';
import { createRng } from './seeds';
import { MATERIAL, type Fragment } from './Fragment';
import type { BatchSlot } from '../physics/PhysicsWorld';

export interface FragmentMaterials {
  exterior: Material;
  interior: Material;
  glass: MeshPhysicalMaterial;
  /** 불씨 깜빡임·흔들림 시계 (s). 매 프레임 갱신 */
  fireTime: { value: number };
  /** 손상 데이터 텍스처 (재질별, FragmentMeshes가 채운다) */
  damageMaps: { exterior: { value: DataTexture }; interior: { value: DataTexture } };
  /** 손상 외관 효과 켬(1)/끔(0) */
  damageOn: { value: number };
}

/** 외부면 정점 속성: 폴리곤 경계 1, 중심 0 (균열 위치) */
export const RIM_ATTRIBUTE = 'rim';

/** 빈 손상 텍스처 (건물이 없을 때) */
function emptyDamageMap(): DataTexture {
  const t = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType);
  t.needsUpdate = true;
  return t;
}

/** 단면 지오메트리의 원래 자리 월드 좌표 속성 (트라이플래너 입력) */
export const REST_ATTRIBUTE = 'rest';

/** assets가 없으면(테스트) 단색 재질 */
export function createFragmentMaterials(
  assets: Assets | null = null,
  glassMode: GlassMode = GLASS.defaultMode,
): FragmentMaterials {
  const exterior = new MeshStandardMaterial({
    color: assets
      ? new Color(CONCRETE.exteriorTint).multiplyScalar(CONCRETE.exteriorBrightness)
      : CONCRETE.exteriorColor,
    roughness: assets ? 1 : CONCRETE.exteriorRoughness,
  });
  const interior = new MeshStandardMaterial({
    color: assets
      ? new Color(CONCRETE.interiorTint).multiplyScalar(CONCRETE.interiorBrightness)
      : CONCRETE.interiorColor,
    roughness: CONCRETE.interiorRoughness,
    // 이음매에서 이웃 조각의 외부면과 깊이가 같아지는 픽셀에서 외부면이 이기도록 단면을 살짝 뒤로 민다
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  if (assets) {
    exterior.map = assets.exterior.color;
    exterior.normalMap = assets.exterior.normal;
    exterior.roughnessMap = assets.exterior.roughness;
    exterior.aoMap = assets.exterior.ao ?? null;
    exterior.normalScale = new Vector2(CONCRETE.normalScale, CONCRETE.normalScale);
    interior.map = assets.interior.color;
    interior.normalMap = assets.interior.normal;
    interior.roughnessMap = assets.interior.roughness;
    interior.normalScale = new Vector2(CONCRETE.normalScale, CONCRETE.normalScale);
    makeTriplanar(interior);
  }
  const fireTime = { value: 0 };
  const damageMaps = {
    exterior: { value: emptyDamageMap() },
    interior: { value: emptyDamageMap() },
  };
  const damageOn = { value: DAMAGE_VISUAL.enabled ? 1 : 0 };
  addSurfaceFx(exterior, fireTime, damageMaps.exterior, damageOn);
  addSurfaceFx(interior, fireTime, damageMaps.interior, damageOn);
  const glass = new MeshPhysicalMaterial({
    color: GLASS.color,
    roughness: GLASS.roughness,
    metalness: GLASS.metalness,
    ior: GLASS.ior,
  });
  setGlassMode(glass, glassMode);
  return { exterior, interior, glass, fireTime, damageMaps, damageOn };
}

/**
 * 'reflective': 반투명 + 센 환경 반사. 'transmission': 굴절 투과 (불투명 물체를 한 번 더 그리는 패스가 생긴다).
 * 엑스레이 화면이 켜져 있는 동안엔 바꾸지 않는다 (그쪽이 transparent를 저장/복원한다).
 */
export function setGlassMode(glass: MeshPhysicalMaterial, mode: GlassMode): void {
  const transmission = mode === 'transmission';
  glass.transmission = transmission ? GLASS.transmission : 0;
  glass.thickness = transmission ? GLASS.thickness : 0;
  glass.transparent = !transmission;
  glass.opacity = transmission ? 1 : GLASS.opacity;
  glass.envMapIntensity = transmission ? 1 : GLASS.envMapIntensity;
  glass.needsUpdate = true;
}

const TRIPLANAR_VERTEX_PARS = /* glsl */ `
attribute vec3 ${REST_ATTRIBUTE};
varying vec3 vRest;
varying vec3 vObjNormal;
varying mat3 vObjToView;`;

const TRIPLANAR_VERTEX = /* glsl */ `
vRest = ${REST_ATTRIBUTE};
vObjNormal = objectNormal;
#ifdef USE_BATCHING
  vObjToView = normalMatrix * mat3( batchingMatrix );
#else
  vObjToView = normalMatrix;
#endif`;

const TRIPLANAR_FRAGMENT_PARS = /* glsl */ `
uniform float triScale;
uniform float triSharpness;
varying vec3 vRest;
varying vec3 vObjNormal;
varying mat3 vObjToView;`;

const TRIPLANAR_MAP = /* glsl */ `
vec3 triP = vRest * triScale;
vec3 triN = normalize( vObjNormal );
vec3 triW = pow( abs( triN ), vec3( triSharpness ) );
triW /= triW.x + triW.y + triW.z;
diffuseColor *= texture2D( map, triP.zy ) * triW.x + texture2D( map, triP.xz ) * triW.y
  + texture2D( map, triP.xy ) * triW.z;`;

const TRIPLANAR_ROUGHNESS = /* glsl */ `
float roughnessFactor = roughness * ( texture2D( roughnessMap, triP.zy ).g * triW.x
  + texture2D( roughnessMap, triP.xz ).g * triW.y + texture2D( roughnessMap, triP.xy ).g * triW.z );`;

const TRIPLANAR_NORMAL = /* glsl */ `
vec3 tnX = texture2D( normalMap, triP.zy ).xyz * 2.0 - 1.0;
vec3 tnY = texture2D( normalMap, triP.xz ).xyz * 2.0 - 1.0;
vec3 tnZ = texture2D( normalMap, triP.xy ).xyz * 2.0 - 1.0;
tnX.xy *= normalScale;
tnY.xy *= normalScale;
tnZ.xy *= normalScale;
vec3 nX = vec3( tnX.xy + triN.zy, abs( tnX.z ) * triN.x );
vec3 nY = vec3( tnY.xy + triN.xz, abs( tnY.z ) * triN.y );
vec3 nZ = vec3( tnZ.xy + triN.xy, abs( tnZ.z ) * triN.z );
normal = normalize( vObjToView * normalize( nX.zyx * triW.x + nY.xzy * triW.y + nZ * triW.z ) );`;

/**
 * 단면 재질을 트라이플래너로: 조각 원래 자리 좌표(rest)를 세 축 평면에 투영해 color/roughness/normal을
 * 법선 가중으로 섞는다. 좌표와 법선은 조각 로컬(객체 공간)이라 조각이 굴러도 텍스처가 붙어 다닌다.
 * 노멀은 whiteout 블렌드(Golus) → 객체 공간 → 뷰 공간 (BatchedMesh 인스턴스 회전 포함).
 */
function makeTriplanar(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.triScale = { value: TEXTURES.interiorScale };
    shader.uniforms.triSharpness = { value: TEXTURES.triplanarSharpness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${TRIPLANAR_VERTEX_PARS}`)
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>${TRIPLANAR_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${TRIPLANAR_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', TRIPLANAR_MAP)
      .replace('#include <roughnessmap_fragment>', TRIPLANAR_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', TRIPLANAR_NORMAL);
  };
  material.customProgramCacheKey = () => 'triplanar';
}

const FX_VERTEX_PARS = /* glsl */ `
uniform float uFireTime;
uniform highp sampler2D uDamageMap;
uniform float uDamageOn;
uniform float uSwayAmp;
uniform float uSwayHz;
attribute float ${RIM_ATTRIBUTE};
varying vec3 vEmberPos;
varying float vRim;
varying vec4 vDamage;`;

// 손상 데이터 읽기 + 매달린 조각 흔들림 (아주 작게: 렌더↔콜라이더 1cm 불변 조건 안)
const FX_VERTEX = /* glsl */ `
vEmberPos = position;
vRim = ${RIM_ATTRIBUTE};
vDamage = vec4( 0.0 );
#ifdef USE_BATCHING
{
  int kId = int( getIndirectIndex( gl_DrawID ) );
  int kSize = textureSize( uDamageMap, 0 ).x;
  vDamage = texelFetch( uDamageMap, ivec2( kId % kSize, kId / kSize ), 0 ) * uDamageOn;
}
#endif
{
  float kPhase = vDamage.b * 6.2832 + uFireTime * uSwayHz * 6.2832;
  transformed += vec3( sin( kPhase ), 0.0, cos( kPhase * 0.77 ) ) * uSwayAmp * vDamage.g;
}`;

const EMBER_FRAGMENT_PARS = /* glsl */ `
uniform float uFireTime;
uniform vec3 uCrackColor;
uniform float uEmberScale;
uniform float uDamageCrackWidth;
uniform float uDamageCrackStrength;
uniform float uDamageNoise;
uniform float uDamageGrime;
uniform float uDamageEdgeNormal;
varying vec3 vEmberPos;
varying float vRim;
varying vec4 vDamage;
${NOISE_GLSL}`;

// 균열(경계 쪽 어두운 선) + 먼지·그을음 톤.
// 가벼운 손상엔 균열이 없고, damage가 클수록 굵어진다. 굵기를 경계를 따라 노이즈로 바꿔(점선처럼 끊지 않고)
// 들쭉날쭉한 깨진 선처럼 보이게 한다.
const DAMAGE_COLOR = /* glsl */ `
float kDamage = vDamage.r;
if ( kDamage > 0.001 ) {
  float kAmount = smoothstep( 0.15, 1.0, kDamage );
  float kN = kFbm( vEmberPos * uDamageNoise );
  float kW = uDamageCrackWidth * kAmount * ( 0.15 + 1.2 * kN * kN );
  float kEdge = 1.0 - vRim; // 경계 0 → 중심 1
  float kCrack = kAmount * ( 1.0 - smoothstep( kW * 0.35, kW, kEdge ) );
  diffuseColor.rgb *= 1.0 - uDamageCrackStrength * kCrack;
  float kGrime = kDamage * uDamageGrime * ( 0.5 + 0.5 * kNoise( vEmberPos * 1.7 + 11.0 ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.5, 0.47, 0.43 ), kGrime );
}`;

// 경계 근처 노멀을 흔들어 모서리가 부서진 느낌
const DAMAGE_NORMAL = /* glsl */ `
if ( kDamage > 0.001 ) {
  vec3 kQ = vEmberPos * uDamageNoise * 0.6;
  vec3 kJitter = vec3( kNoise( kQ ), kNoise( kQ + 3.7 ), kNoise( kQ + 7.1 ) ) - 0.5;
  normal = normalize( normal + kJitter * uDamageEdgeNormal * kDamage * smoothstep( 0.5, 1.0, vRim ) );
}`;

// 불씨: 갈라진 틈 무늬(노이즈 줄무늬) × 깜빡임. 불투명일 때만 (엑스레이 중엔 알파가 투명도)
const EMBER_FRAGMENT = /* glsl */ `
#if defined( OPAQUE ) && defined( USE_COLOR )
{
  float ember = 1.0 - vColor.a;
  if ( ember > 0.002 ) {
    vec3 ep = vEmberPos * uEmberScale;
    float n = kFbm( ep + vec3( 0.0, -uFireTime * 0.4, 0.0 ) );
    float crack = 1.0 - smoothstep( 0.0, 0.08, abs( n - 0.5 ) );
    float flicker = 0.65 + 0.35 * sin( uFireTime * 7.0 + kNoise( ep * 0.5 ) * 12.0 );
    totalEmissiveRadiance += uCrackColor * ember * ( 0.12 + crack ) * flicker;
  }
}
#endif`;

/**
 * 외벽·단면 재질에 표면 효과를 덧붙인다 (기존 onBeforeCompile 뒤에 이어서):
 * 불씨 emissive, 손상 균열·열화·노멀, 매달린 조각 흔들림.
 * 단면은 트라이플래너가 map/normal 청크를 바꿔 치우므로 그 뒤 청크(color, emissivemap)에 붙인다.
 */
function addSurfaceFx(
  material: MeshStandardMaterial,
  fireTime: { value: number },
  damageMap: { value: DataTexture },
  damageOn: { value: number },
): void {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  const crack = new Color(FIRE.crackColor).multiplyScalar(FIRE.emberGlow);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    const u = shader.uniforms;
    u.uFireTime = fireTime;
    u.uCrackColor = { value: crack };
    u.uEmberScale = { value: FIRE.emberNoiseScale };
    u.uDamageMap = damageMap;
    u.uDamageOn = damageOn;
    u.uSwayAmp = { value: DAMAGE_VISUAL.swayAmplitude };
    u.uSwayHz = { value: DAMAGE_VISUAL.swayHz };
    u.uDamageCrackWidth = { value: DAMAGE_VISUAL.crackWidth };
    u.uDamageCrackStrength = { value: DAMAGE_VISUAL.crackStrength };
    u.uDamageNoise = { value: DAMAGE_VISUAL.crackNoiseScale };
    u.uDamageGrime = { value: DAMAGE_VISUAL.grimeStrength };
    u.uDamageEdgeNormal = { value: DAMAGE_VISUAL.edgeNormalNoise };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${FX_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${FX_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>${EMBER_FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>${DAMAGE_COLOR}`)
      .replace(
        '#include <emissivemap_fragment>',
        `${DAMAGE_NORMAL}\n#include <emissivemap_fragment>${EMBER_FRAGMENT}`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey()}|fx`;
}

interface DamageBatch {
  texture: DataTexture;
  data: Float32Array;
  dirty: boolean;
}

type Part = BufferGeometry | null;

/** 인스턴스 색 RGBA 스크래치 */
const rgba = new Vector4();

export class FragmentMeshes {
  /** 비어 있지 않은 배치만 */
  readonly batches: BatchedMesh[] = [];
  /** 조각마다 그 조각을 그리는 인스턴스들 (물리 동기화 대상) */
  readonly slots: BatchSlot[][];
  /** 조각별 기본색 RGBA (그을음·불씨). 디버그 색칠·엑스레이가 끝나면 이 색으로 돌아간다 */
  readonly tint: Float32Array;
  /** 조각별 바탕색 RGB (희귀 파편 금빛 등). tint에 곱해져 칠해진다 */
  readonly base: Float32Array;
  /** 디버그 색칠 등 다른 색이 덮고 있으면 true: setTint는 저장만 하고 칠하지 않는다 */
  overlay = false;
  /** 배치별 손상 텍스처 (외벽·단면만, 유리는 없음) */
  private readonly damageBatches = new Map<BatchedMesh, DamageBatch>();
  /** 누적 손상 텍스처 업로드 횟수 (성능 측정) */
  damageUploads = 0;

  constructor(frags: readonly Fragment[], materials: FragmentMaterials) {
    const exterior: Part[] = [];
    const interior: Part[] = [];
    const glass: Part[] = [];
    for (const frag of frags) {
      if (frag.material === MATERIAL.glass) {
        exterior.push(null);
        interior.push(null);
        glass.push(wholeGeometry(frag));
      } else {
        const split = splitByMaterial(frag);
        exterior.push(split.exterior);
        interior.push(split.interior);
        glass.push(null);
      }
    }

    this.slots = frags.map(() => []);
    this.tint = new Float32Array(frags.length * 4).fill(1);
    this.base = new Float32Array(frags.length * 3).fill(1);
    const matrix = new Matrix4();
    for (const [parts, material] of [
      [exterior, materials.exterior],
      [interior, materials.interior],
      [glass, materials.glass],
    ] as const) {
      const batch = createBatch(parts, material);
      if (!batch) continue;
      this.batches.push(batch.mesh);
      const holder =
        material === materials.exterior
          ? materials.damageMaps.exterior
          : material === materials.interior
            ? materials.damageMaps.interior
            : null;
      if (holder) {
        const size = Math.max(1, Math.ceil(Math.sqrt(batch.mesh.maxInstanceCount)));
        const data = new Float32Array(size * size * 4);
        const texture = new DataTexture(data, size, size, RGBAFormat, FloatType);
        texture.needsUpdate = true;
        holder.value.dispose();
        holder.value = texture;
        this.damageBatches.set(batch.mesh, { texture, data, dirty: false });
      }
      frags.forEach((frag, i) => {
        const geometryId = batch.geometryIds[i]!;
        if (geometryId < 0) return; // 이 조각엔 해당 재질 면이 없다 (예: 내부 조각의 외부면)
        const id = batch.mesh.addInstance(geometryId);
        const c = frag.centroid;
        batch.mesh.setMatrixAt(id, matrix.makeTranslation(c.x, c.y, c.z));
        this.slots[i]!.push({ batch: batch.mesh, id });
      });
    }
  }

  /** 디버그: 조각마다 다른 색으로 경계를 보여준다. false면 기본색(tint)으로 */
  setDebugColors(enabled: boolean, seed: number): void {
    if (!enabled) {
      this.overlay = false;
      this.restoreTints();
      return;
    }
    this.overlay = true;
    const rng = createRng(seed);
    const color = new Color();
    for (const slots of this.slots) {
      color.setHSL(rng(), 0.6, 0.55);
      rgba.set(color.r, color.g, color.b, 1);
      for (const { batch, id } of slots) batch.setColorAt(id, rgba);
    }
  }

  /** 조각 i의 기본색 (그을음·불씨). overlay 중이면 저장만 */
  setTint(i: number, r: number, g: number, b: number, a: number): void {
    this.tint.set([r, g, b, a], i * 4);
    if (!this.overlay) this.paint(i);
  }

  /** 조각 i의 바탕색 (희귀 파편 금빛 등). overlay 중이면 저장만 */
  setBaseColor(i: number, r: number, g: number, b: number): void {
    this.base.set([r, g, b], i * 3);
    if (!this.overlay) this.paint(i);
  }

  /** 모든 조각을 기본색으로 다시 칠한다 */
  restoreTints(): void {
    for (let i = 0; i < this.slots.length; i++) this.paint(i);
  }

  /** 인스턴스 색 = 바탕색 × tint (알파는 tint 그대로: 불씨) */
  private paint(i: number): void {
    const t = this.tint;
    const c = this.base;
    rgba.set(
      t[i * 4]! * c[i * 3]!,
      t[i * 4 + 1]! * c[i * 3 + 1]!,
      t[i * 4 + 2]! * c[i * 3 + 2]!,
      t[i * 4 + 3]!,
    );
    for (const { batch, id } of this.slots[i]!) batch.setColorAt(id, rgba);
  }

  /** 조각 i의 손상 외관 값 (damage 0~1, 매달림 0~1, 흔들림 위상 0~1). flushDamage 전까지 GPU에 안 올라간다 */
  setDamage(i: number, damage: number, hanging: number, phase: number): void {
    for (const { batch, id } of this.slots[i]!) {
      const b = this.damageBatches.get(batch);
      if (!b) continue;
      b.data[id * 4] = damage;
      b.data[id * 4 + 1] = hanging;
      b.data[id * 4 + 2] = phase;
      b.dirty = true;
    }
  }

  /** 바뀐 손상 텍스처를 GPU로 (프레임당 한 번). 반환: 올린 텍스처 수 */
  flushDamage(): number {
    let n = 0;
    for (const b of this.damageBatches.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      b.texture.needsUpdate = true;
      n++;
    }
    this.damageUploads += n;
    return n;
  }

  /** 기본색을 전부 흰색(원래 재질 색)으로 */
  resetTints(): void {
    this.tint.fill(1);
    if (!this.overlay) this.restoreTints();
  }

  dispose(): void {
    // 텍스처는 재질 uniform이 쥐고 있어 다음 건물이 바꿔 끼울 때 정리한다
    this.damageBatches.clear();
    for (const batch of this.batches) {
      batch.removeFromParent();
      batch.dispose();
    }
  }
}

function createBatch(
  parts: readonly Part[],
  material: Material,
): { mesh: BatchedMesh; geometryIds: number[] } | null {
  let vertexCount = 0;
  let indexCount = 0;
  let instanceCount = 0;
  for (const g of parts) {
    if (!g) continue;
    vertexCount += g.getAttribute('position').count;
    indexCount += g.getIndex()!.count;
    instanceCount++;
  }
  if (instanceCount === 0) return null;

  const mesh = new BatchedMesh(instanceCount, vertexCount, indexCount, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // 조각이 흩어지면 전체 바운딩 구가 틀어진다 (조각별 컬링은 그대로 동작)
  const geometryIds = parts.map((g) => {
    if (!g) return -1;
    const id = mesh.addGeometry(g);
    g.dispose();
    return id;
  });
  return { mesh, geometryIds };
}

/**
 * 조각 하나를 외부면/단면 지오메트리로 나눈다.
 * buildFragment가 외부면 정점·인덱스를 앞에 몰아두므로 앞/뒤로 자르기만 하면 된다.
 * 단면에는 트라이플래너용 rest 속성을 붙인다.
 */
function splitByMaterial(frag: Fragment): { exterior: Part; interior: Part } {
  const { indices, exteriorIndexCount } = frag;
  let exteriorVertexCount = 0;
  for (let k = 0; k < exteriorIndexCount; k++) {
    exteriorVertexCount = Math.max(exteriorVertexCount, indices[k]! + 1);
  }
  const vertexCount = frag.positions.length / 3;
  return {
    exterior:
      exteriorIndexCount > 0
        ? withRim(
            makeGeometry(frag, 0, exteriorVertexCount, indices.subarray(0, exteriorIndexCount), 0),
          )
        : null,
    interior:
      exteriorIndexCount < indices.length
        ? withRest(
            makeGeometry(
              frag,
              exteriorVertexCount,
              vertexCount,
              indices.subarray(exteriorIndexCount),
              exteriorVertexCount,
            ),
            frag,
          )
        : null,
  };
}

function wholeGeometry(frag: Fragment): BufferGeometry {
  return makeGeometry(frag, 0, frag.positions.length / 3, frag.indices, 0);
}

function makeGeometry(
  frag: Fragment,
  vertexStart: number,
  vertexEnd: number,
  indices: Uint32Array,
  indexOffset: number,
): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(frag.positions.slice(vertexStart * 3, vertexEnd * 3), 3),
  );
  g.setAttribute(
    'normal',
    new BufferAttribute(frag.normals.slice(vertexStart * 3, vertexEnd * 3), 3),
  );
  g.setAttribute('uv', new BufferAttribute(frag.uvs.slice(vertexStart * 2, vertexEnd * 2), 2));
  g.setIndex(
    new BufferAttribute(
      indices.map((i) => i - indexOffset),
      1,
    ),
  );
  return g;
}

/**
 * 외부면을 폴리곤 중심 팬으로 다시 삼각화하고 rim 속성(경계 정점 1, 중심 0)을 붙인다.
 * buildFragment는 폴리곤마다 정점을 연속으로 두고 첫 정점 기준 팬(v0, vk, vk+1)으로 삼각화하므로
 * 같은 첫 정점을 가진 삼각형들이 한 폴리곤이다. 폴리곤 하나에 정점이 1개(중심) 늘어난다.
 */
export function withRim(g: BufferGeometry): BufferGeometry {
  const index = g.getIndex()!.array;
  const pos = g.getAttribute('position').array;
  const nor = g.getAttribute('normal').array;
  const uv = g.getAttribute('uv').array;
  const polys: { start: number; count: number }[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const first = index[t]!;
    const last = polys[polys.length - 1];
    if (last && last.start === first) last.count++;
    else polys.push({ start: first, count: 1 });
  }
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of polys) {
    vertexCount += p.count + 3; // 정점 n = 삼각형 + 2, + 중심
    indexCount += (p.count + 2) * 3;
  }
  const P = new Float32Array(vertexCount * 3);
  const N = new Float32Array(vertexCount * 3);
  const U = new Float32Array(vertexCount * 2);
  const R = new Float32Array(vertexCount);
  const I = new Uint32Array(indexCount);
  let v = 0;
  let ii = 0;
  for (const p of polys) {
    const n = p.count + 2;
    const c = v + n;
    for (let k = 0; k < n; k++) {
      const src = p.start + k;
      for (let a = 0; a < 3; a++) {
        P[(v + k) * 3 + a] = pos[src * 3 + a]!;
        N[(v + k) * 3 + a] = nor[src * 3 + a]!;
        P[c * 3 + a]! += pos[src * 3 + a]! / n;
      }
      U[(v + k) * 2] = uv[src * 2]!;
      U[(v + k) * 2 + 1] = uv[src * 2 + 1]!;
      U[c * 2]! += uv[src * 2]! / n;
      U[c * 2 + 1]! += uv[src * 2 + 1]! / n;
      R[v + k] = 1;
      I[ii++] = c;
      I[ii++] = v + k;
      I[ii++] = v + ((k + 1) % n);
    }
    for (let a = 0; a < 3; a++) N[c * 3 + a] = nor[p.start * 3 + a]!;
    R[c] = 0;
    v = c + 1;
  }
  g.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(P, 3));
  out.setAttribute('normal', new BufferAttribute(N, 3));
  out.setAttribute('uv', new BufferAttribute(U, 2));
  out.setAttribute(RIM_ATTRIBUTE, new BufferAttribute(R, 1));
  out.setIndex(new BufferAttribute(I, 1));
  return out;
}

/** 원래 자리 월드 좌표 = 로컬 정점 + 질량중심 (워커에서 따로 보내지 않고 여기서 만든다) */
export function withRest(g: BufferGeometry, frag: Fragment): BufferGeometry {
  const pos = g.getAttribute('position');
  const rest = new Float32Array(pos.count * 3);
  const c = frag.centroid;
  for (let k = 0; k < pos.count; k++) {
    rest[k * 3] = pos.getX(k) + c.x;
    rest[k * 3 + 1] = pos.getY(k) + c.y;
    rest[k * 3 + 2] = pos.getZ(k) + c.z;
  }
  g.setAttribute(REST_ATTRIBUTE, new BufferAttribute(rest, 3));
  return g;
}
