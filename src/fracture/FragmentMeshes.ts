// 조각 렌더: 재질별 BatchedMesh (콘크리트 외면 / 콘크리트 단면 / 유리) → 드로우콜 최대 3개
// 외면: 부재 기준 박스 투영 UV (Fragment.ts). 단면: 조각 원래 자리 좌표(rest)로 트라이플래너.
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
  Vector4,
  type Material,
} from 'three';
import { CONCRETE, GLASS, TEXTURES, type GlassMode } from '../config';
import type { Assets } from '../core/Assets';
import { createRng } from './seeds';
import { MATERIAL, type Fragment } from './Fragment';
import type { BatchSlot } from '../physics/PhysicsWorld';

export interface FragmentMaterials {
  exterior: Material;
  interior: Material;
  glass: MeshPhysicalMaterial;
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
  const glass = new MeshPhysicalMaterial({
    color: GLASS.color,
    roughness: GLASS.roughness,
    metalness: GLASS.metalness,
    ior: GLASS.ior,
  });
  setGlassMode(glass, glassMode);
  return { exterior, interior, glass };
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

type Part = BufferGeometry | null;

/** 인스턴스 색은 RGBA로 쓴다 (엑스레이 화면이 알파를 바꾸므로 되돌릴 때 알파도 1로) */
const WHITE = new Vector4(1, 1, 1, 1);

export class FragmentMeshes {
  /** 비어 있지 않은 배치만 */
  readonly batches: BatchedMesh[] = [];
  /** 조각마다 그 조각을 그리는 인스턴스들 (물리 동기화 대상) */
  readonly slots: BatchSlot[][];

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
    const matrix = new Matrix4();
    for (const [parts, material] of [
      [exterior, materials.exterior],
      [interior, materials.interior],
      [glass, materials.glass],
    ] as const) {
      const batch = createBatch(parts, material);
      if (!batch) continue;
      this.batches.push(batch.mesh);
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

  /** 디버그: 조각마다 다른 색으로 경계를 보여준다. false면 원래 재질 색. */
  setDebugColors(enabled: boolean, seed: number): void {
    const rng = createRng(seed);
    const color = new Color();
    const rgba = new Vector4();
    for (const slots of this.slots) {
      if (enabled) color.setHSL(rng(), 0.6, 0.55);
      rgba.set(color.r, color.g, color.b, 1);
      for (const { batch, id } of slots) batch.setColorAt(id, enabled ? rgba : WHITE);
    }
  }

  dispose(): void {
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
        ? makeGeometry(frag, 0, exteriorVertexCount, indices.subarray(0, exteriorIndexCount), 0)
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
