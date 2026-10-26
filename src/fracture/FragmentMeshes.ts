// 조각 렌더: 재질별 BatchedMesh (콘크리트 외면 / 콘크리트 단면 / 유리) → 드로우콜 최대 3개
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { CONCRETE, GLASS } from '../config';
import { createRng } from './seeds';
import { MATERIAL, type Fragment } from './Fragment';
import type { BatchSlot } from '../physics/PhysicsWorld';

export interface FragmentMaterials {
  exterior: Material;
  interior: Material;
  glass: Material;
}

export function createFragmentMaterials(): FragmentMaterials {
  return {
    exterior: new MeshStandardMaterial({
      color: CONCRETE.exteriorColor,
      roughness: CONCRETE.exteriorRoughness,
    }),
    interior: new MeshStandardMaterial({
      color: CONCRETE.interiorColor,
      roughness: CONCRETE.interiorRoughness,
      // 이음매에서 이웃 조각의 외부면과 깊이가 같아지는 픽셀에서 외부면이 이기도록 단면을 살짝 뒤로 민다
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
    glass: new MeshPhysicalMaterial({
      color: GLASS.color,
      roughness: GLASS.roughness,
      metalness: GLASS.metalness,
      transparent: true,
      opacity: GLASS.opacity,
    }),
  };
}

type Part = BufferGeometry | null;

const WHITE = new Color(1, 1, 1);

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
    for (const slots of this.slots) {
      if (enabled) color.setHSL(rng(), 0.6, 0.55);
      for (const { batch, id } of slots) batch.setColorAt(id, enabled ? color : WHITE);
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
        ? makeGeometry(
            frag,
            exteriorVertexCount,
            vertexCount,
            indices.subarray(exteriorIndexCount),
            exteriorVertexCount,
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
