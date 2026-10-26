// Phase 2 분할 데모: 콘크리트 박스 1개를 보로노이로 사전 분할 → 처음엔 fixed, 클릭하면 폭발로 흩어진다.
// 건물이 들어오면(Phase 3) 제거한다.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  MeshStandardMaterial,
  Raycaster,
  Vector2,
  Vector3,
  type Intersection,
} from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CONCRETE, DEBRIS, FRACTURE_DEMO } from '../config';
import type { Renderer } from '../core/Renderer';
import { applyExplosion } from '../destruction/Explosion';
import { fractureInWorker } from '../fracture/FractureJob';
import type { Fragment } from '../fracture/Fragment';
import { adaptiveSeeds, createRng, jitteredGridSeeds, uniformSeeds } from '../fracture/seeds';
import {
  isBatchSlots,
  type BatchSlot,
  type PhysicsBody,
  type PhysicsWorld,
} from '../physics/PhysicsWorld';
import { createStage, onCanvasClick } from './Stage';

export type SeedMode = 'uniform' | 'jittered' | 'adaptive';

export interface FractureDemoSettings {
  seedCount: number;
  seedMode: SeedMode;
  rngSeed: number;
}

const BOX = { min: FRACTURE_DEMO.boxMin, max: FRACTURE_DEMO.boxMax };

export class FractureDemo {
  readonly settings: FractureDemoSettings = {
    seedCount: FRACTURE_DEMO.seedCount,
    seedMode: 'uniform',
    rngSeed: FRACTURE_DEMO.rngSeed,
  };
  /** 마지막 분할에 걸린 시간(ms), 디버그 표시용 */
  lastFractureMs = 0;

  private readonly controls: OrbitControls;
  private readonly exteriorMaterial = new MeshStandardMaterial({
    color: CONCRETE.exteriorColor,
    roughness: CONCRETE.exteriorRoughness,
  });
  private readonly interiorMaterial = new MeshStandardMaterial({
    color: CONCRETE.interiorColor,
    roughness: CONCRETE.interiorRoughness,
    // 이음매에서 이웃 조각의 외부면과 깊이가 같아지는 픽셀에서 외부면이 이기도록 단면을 살짝 뒤로 민다
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  private batches: BatchedMesh[] = [];
  private bodies: PhysicsBody[] = [];
  private shattered = false;
  /** reset이 겹쳐 들어오면 늦게 끝난 이전 분할 결과를 버리기 위한 세대 번호 */
  private generation = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hits: Intersection[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly physics: PhysicsWorld,
  ) {
    this.controls = createStage(
      renderer,
      physics,
      FRACTURE_DEMO.cameraPosition,
      FRACTURE_DEMO.cameraTarget,
    );
    onCanvasClick(renderer.canvas, (x, y) => {
      this.pointer.set(x, y);
      this.explodeAtPointer();
    });
    this.reset();
  }

  update(): void {
    this.controls.update();
    this.physics.removeBelow(DEBRIS.killY, this.onBodyRemoved);
  }

  /** 현재 설정으로 박스를 다시 분할해 새로 세운다 */
  reset(): void {
    const generation = ++this.generation;
    this.clear();
    const started = performance.now();
    fractureInWorker({ box: BOX, seeds: this.makeSeeds() })
      .then((frags) => {
        if (generation !== this.generation) return;
        this.lastFractureMs = Math.round(performance.now() - started);
        this.build(frags);
      })
      .catch((err: unknown) => console.error('fracture failed', err));
  }

  private makeSeeds(): Float64Array {
    const { seedCount, seedMode, rngSeed } = this.settings;
    const rng = createRng(rngSeed);
    switch (seedMode) {
      case 'uniform':
        return uniformSeeds(BOX, seedCount, rng);
      case 'jittered':
        return jitteredGridSeeds(BOX, seedCount, rng);
      case 'adaptive': {
        // 정면 중앙 근처를 잘게
        const focus = {
          x: (BOX.min.x + BOX.max.x) / 2,
          y: (BOX.min.y + BOX.max.y) / 2,
          z: BOX.max.z,
        };
        return adaptiveSeeds(BOX, seedCount, focus, rng);
      }
    }
  }

  private build(frags: Fragment[]): void {
    // 외부면/단면을 재질별 BatchedMesh 두 개로 나눈다 (드로우콜 2개)
    const parts = frags.map(splitByMaterial);
    const exterior = this.createBatch(
      parts.map((p) => p.exterior),
      this.exteriorMaterial,
    );
    const interior = this.createBatch(
      parts.map((p) => p.interior),
      this.interiorMaterial,
    );
    this.batches = [exterior.batch, interior.batch];

    frags.forEach((frag, i) => {
      const c = frag.centroid;
      this.matrix.makeTranslation(c.x, c.y, c.z);
      const slots: BatchSlot[] = [];
      for (const { batch, geometryIds } of [exterior, interior]) {
        const geometryId = geometryIds[i]!;
        if (geometryId < 0) continue; // 이 조각엔 해당 재질 면이 없다 (예: 내부 조각의 외부면)
        const id = batch.addInstance(geometryId);
        batch.setMatrixAt(id, this.matrix);
        slots.push({ batch, id });
      }

      const collider = (
        RAPIER.ColliderDesc.convexHull(frag.hull) ??
        // 퇴화 hull(사실상 없음) 대비: 같은 부피의 구
        RAPIER.ColliderDesc.ball(Math.cbrt((3 * frag.volume) / (4 * Math.PI)))
      )
        .setDensity(CONCRETE.density)
        .setFriction(CONCRETE.friction);
      this.bodies.push(
        this.physics.add(
          RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z),
          collider,
          slots,
        ),
      );
    });

    for (const batch of this.batches) this.renderer.scene.add(batch);
  }

  private createBatch(
    geometries: (BufferGeometry | null)[],
    material: MeshStandardMaterial,
  ): { batch: BatchedMesh; geometryIds: number[] } {
    let vertexCount = 0;
    let indexCount = 0;
    for (const g of geometries) {
      if (!g) continue;
      vertexCount += g.getAttribute('position').count;
      indexCount += g.getIndex()!.count;
    }
    const batch = new BatchedMesh(
      geometries.length,
      Math.max(vertexCount, 1),
      Math.max(indexCount, 1),
      material,
    );
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.frustumCulled = false; // 조각이 흩어지면 전체 바운딩 구가 틀어진다 (조각별 컬링은 그대로 동작)
    const geometryIds = geometries.map((g) => {
      if (!g) return -1;
      const id = batch.addGeometry(g);
      g.dispose();
      return id;
    });
    return { batch, geometryIds };
  }

  private explodeAtPointer(): void {
    if (this.batches.length === 0) return;
    this.raycaster.setFromCamera(this.pointer, this.renderer.camera);
    this.hits.length = 0;
    this.raycaster.intersectObjects(this.batches, false, this.hits);
    const hit = this.hits[0];
    if (!hit) return;

    if (!this.shattered) {
      this.shattered = true;
      for (const body of this.bodies)
        body.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    }
    applyExplosion(this.bodies, this.position.copy(hit.point), {
      radius: FRACTURE_DEMO.explosionRadius,
    });
  }

  private clear(): void {
    for (const body of this.bodies) this.physics.remove(body);
    this.bodies = [];
    for (const batch of this.batches) {
      this.renderer.scene.remove(batch);
      batch.dispose();
    }
    this.batches = [];
    this.shattered = false;
  }

  private readonly onBodyRemoved = (body: PhysicsBody): void => {
    const target = body.target;
    if (!target || !isBatchSlots(target)) return;
    for (const slot of target) slot.batch.setVisibleAt(slot.id, false);
  };
}

/**
 * 조각 하나를 외부면/단면 지오메트리로 나눈다.
 * buildFragment가 외부면 정점·인덱스를 앞에 몰아두므로 앞/뒤로 자르기만 하면 된다.
 */
function splitByMaterial(frag: Fragment): {
  exterior: BufferGeometry | null;
  interior: BufferGeometry | null;
} {
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
