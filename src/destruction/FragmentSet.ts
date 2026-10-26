// 분할된 물체 하나: 조각 렌더(FragmentMeshes) + 조각들을 담는 물리 덩어리(Chunk).
// 덩어리 = 바디 하나 + 조각 1개 이상. 처음엔 조각마다 fixed 덩어리 1개.
// - activate: fixed → dynamic
// - merge: 서 있는 조각 여럿을 dynamic compound 덩어리 하나로 (지지 잃은 섬)
// - split: 덩어리를 여러 덩어리/조각으로 (충격 분해). 자세와 속도를 이어받는다.
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3, type Intersection, type Raycaster, type Scene } from 'three';
import { CONCRETE, DEBRIS, GLASS } from '../config';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import { FragmentMeshes, type FragmentMaterials } from '../fracture/FragmentMeshes';
import type { Vec3Like } from '../fracture/polyhedron';
import {
  forEachSlot,
  type ChunkPart,
  type PhysicsBody,
  type PhysicsWorld,
  type SyncTarget,
} from '../physics/PhysicsWorld';

export interface Chunk {
  readonly body: PhysicsBody;
  readonly frags: readonly number[];
  /** 바디 좌표계에서 각 조각 질량중심 (frags와 같은 순서) */
  readonly offsets: readonly Vector3[];
  readonly volume: number;
  /** 충격 감지용: 지난 스텝 선속도 */
  readonly lastVelocity: Vector3;
}

export interface FragmentSetOptions {
  /**
   * 부피가 이 값 이하인 조각은 convexHull 대신 같은 부피의 cuboid 콜라이더를 쓴다
   * (박스-박스 접촉이 볼록-볼록보다 싸다). 0이면 전부 convexHull.
   */
  simpleColliderMaxVolume?: number;
  /** 덩어리가 dynamic이 된 직후 (activate, merge, split 모두) */
  onDynamic?: (chunk: Chunk) => void;
}

interface FragmentShape {
  shape: RAPIER.Shape;
  /** 조각 질량중심 기준 콜라이더 위치 (cuboid는 AABB 중심이 질량중심과 다르다) */
  base: Vector3;
  density: number;
  friction: number;
}

interface Fading {
  chunk: Chunk;
  time: number;
}

const ZERO = new Vector3();
const IDENTITY = new Quaternion();
const scratchInv = new Quaternion();
const scratchVec = new Vector3();
const scratchMatrix = new Matrix4();
const scratchScale = new Vector3();

export class FragmentSet {
  readonly meshes: FragmentMeshes;
  /** 조각이 들어 있는 덩어리 (제거됐으면 null) */
  readonly chunkOf: (Chunk | null)[];
  private readonly chunks = new Map<PhysicsBody, Chunk>();
  private readonly shapes: FragmentShape[];
  private readonly fading: Fading[] = [];
  private readonly hits: Intersection[] = [];
  private readonly onDynamic?: (chunk: Chunk) => void;

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
    readonly fragments: readonly Fragment[],
    materials: FragmentMaterials,
    options: FragmentSetOptions = {},
  ) {
    this.onDynamic = options.onDynamic;
    const simpleMax = options.simpleColliderMaxVolume ?? 0;
    this.meshes = new FragmentMeshes(fragments, materials);
    this.shapes = fragments.map((frag) => {
      const glass = frag.material === MATERIAL.glass;
      const desc = frag.volume <= simpleMax ? cuboidCollider(frag) : hullCollider(frag);
      const t = desc.translation;
      return {
        shape: desc.shape,
        base: new Vector3(t.x, t.y, t.z),
        density: glass ? GLASS.density : CONCRETE.density,
        friction: glass ? GLASS.friction : CONCRETE.friction,
      };
    });
    this.chunkOf = fragments.map(() => null);
    fragments.forEach((frag, i) =>
      this.createChunk([i], [ZERO], frag.centroid, IDENTITY, ZERO, ZERO, false),
    );
    for (const batch of this.meshes.batches) scene.add(batch);
  }

  /** 살아 있는 덩어리 바디 전부 (applyExplosion 등) */
  bodies(): Iterable<PhysicsBody> {
    return this.chunks.keys();
  }

  chunkOfBody(body: PhysicsBody): Chunk | undefined {
    return this.chunks.get(body);
  }

  /** 조각이 든 덩어리를 fixed → dynamic. 이미 dynamic이거나 제거됐으면 false. */
  activate(index: number): boolean {
    const chunk = this.chunkOf[index];
    return chunk ? this.activateChunk(chunk) : false;
  }

  activateChunk(chunk: Chunk): boolean {
    const body = chunk.body;
    if (!body.alive || !body.rigidBody.isFixed()) return false;
    this.cancelFade(chunk);
    this.physics.setDynamic(body);
    chunk.lastVelocity.set(0, 0, 0);
    this.onDynamic?.(chunk);
    return true;
  }

  activateAll(): void {
    for (const chunk of [...this.chunks.values()]) this.activateChunk(chunk);
  }

  /** 바디 위치가 center에서 radius 안인 fixed 덩어리를 activate. 반환: 활성화된 수 */
  activateWithin(center: Vec3Like, radius: number): number {
    const r2 = radius * radius;
    let n = 0;
    for (const chunk of [...this.chunks.values()]) {
      const p = chunk.body.currPos;
      const d2 = (p.x - center.x) ** 2 + (p.y - center.y) ** 2 + (p.z - center.z) ** 2;
      if (d2 <= r2 && this.activateChunk(chunk)) n++;
    }
    return n;
  }

  /**
   * 원래 자리에 서 있는 조각들(각자 fixed 단일 덩어리)을 dynamic compound 덩어리 하나로 묶는다.
   * 바디 원점 = 조각들의 질량중심.
   */
  merge(indices: readonly number[]): Chunk {
    const frags = this.fragments;
    const origin = new Vector3();
    let total = 0;
    for (const i of indices) {
      const f = frags[i]!;
      const m = f.volume * this.shapes[i]!.density;
      origin.x += f.centroid.x * m;
      origin.y += f.centroid.y * m;
      origin.z += f.centroid.z * m;
      total += m;
    }
    origin.divideScalar(total);
    const offsets = indices.map((i) => {
      const c = frags[i]!.centroid;
      return new Vector3(c.x - origin.x, c.y - origin.y, c.z - origin.z);
    });
    for (const i of indices) {
      const old = this.chunkOf[i];
      if (old) this.removeChunk(old, false);
    }
    const chunk = this.createChunk(indices, offsets, origin, IDENTITY, ZERO, ZERO, true);
    this.onDynamic?.(chunk);
    return chunk;
  }

  /**
   * 덩어리를 groups(조각 인덱스 묶음)대로 나눈다. 각 묶음은 현재 자세 그대로,
   * 속도는 강체 운동(v + ω × r)을 이어받는다. 1개짜리 묶음은 단일 조각 덩어리.
   */
  split(chunk: Chunk, groups: readonly (readonly number[])[]): Chunk[] {
    const rb = chunk.body.rigidBody;
    const pos = chunk.body.currPos.clone();
    const quat = chunk.body.currQuat.clone();
    const v = rb.linvel();
    const w = rb.angvel();
    const linvel = new Vector3(v.x, v.y, v.z);
    const angvel = new Vector3(w.x, w.y, w.z);
    const offsetOf = new Map<number, Vector3>();
    chunk.frags.forEach((f, k) => offsetOf.set(f, chunk.offsets[k]!));
    this.removeChunk(chunk, false);

    scratchInv.copy(quat).invert();
    return groups.map((group) => {
      // 조각들의 현재 월드 위치 → 새 원점 = 질량중심
      const world = group.map((f) => offsetOf.get(f)!.clone().applyQuaternion(quat).add(pos));
      const origin = new Vector3();
      let total = 0;
      group.forEach((f, k) => {
        const m = this.fragments[f]!.volume * this.shapes[f]!.density;
        origin.addScaledVector(world[k]!, m);
        total += m;
      });
      origin.divideScalar(total);
      const offsets = world.map((p) => p.sub(origin).applyQuaternion(scratchInv));
      const lin = scratchVec.copy(origin).sub(pos);
      lin.crossVectors(angvel, lin).add(linvel);
      const created = this.createChunk(group, offsets, origin, quat, lin, angvel, true);
      this.onDynamic?.(created);
      return created;
    });
  }

  /** 덩어리를 물리·렌더에서 뺀다 (상한 초과, 킬 높이, 페이드아웃 끝). hide=false는 재조립용. */
  removeChunk(chunk: Chunk, hide = true): void {
    if (hide) forEachSlot(chunk.body.target, (s) => s.batch.setVisibleAt(s.id, false));
    for (const f of chunk.frags) if (this.chunkOf[f] === chunk) this.chunkOf[f] = null;
    this.chunks.delete(chunk.body);
    const i = this.fading.findIndex((f) => f.chunk === chunk);
    if (i >= 0) this.fading.splice(i, 1);
    this.physics.remove(chunk.body);
  }

  /** fadeOutSec 뒤 fadeDurationSec 동안 작아지다 사라진다. 그 전에 다시 activate되면 취소. */
  fade(chunk: Chunk): void {
    if (!this.fading.some((f) => f.chunk === chunk)) this.fading.push({ chunk, time: 0 });
  }

  /** 렌더 프레임마다: 페이드아웃 진행 */
  updateFades(dt: number): void {
    const delay = DEBRIS.fadeOutSec;
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i]!;
      f.time += dt;
      if (f.time < delay) continue;
      const scale = 1 - (f.time - delay) / DEBRIS.fadeDurationSec;
      if (scale <= 0) {
        this.removeChunk(f.chunk); // fading 목록에서도 빠진다
        continue;
      }
      const body = f.chunk.body;
      scratchMatrix.compose(body.currPos, body.currQuat, scratchScale.setScalar(scale));
      forEachSlot(body.target, (s) => s.batch.setMatrixAt(s.id, scratchMatrix));
    }
  }

  get fadingCount(): number {
    return this.fading.length;
  }

  /** 가장 가까운 조각 표면 교차 (없으면 undefined) */
  raycast(raycaster: Raycaster): Intersection | undefined {
    this.hits.length = 0;
    raycaster.intersectObjects(this.meshes.batches, false, this.hits);
    return this.hits[0];
  }

  dispose(): void {
    for (const body of this.chunks.keys()) this.physics.remove(body);
    this.chunks.clear();
    this.fading.length = 0;
    this.meshes.dispose();
  }

  private createChunk(
    frags: readonly number[],
    offsets: readonly Vector3[],
    position: Vec3Like,
    rotation: Quaternion,
    linvel: Vec3Like,
    angvel: Vec3Like,
    dynamic: boolean,
  ): Chunk {
    const colliders = frags.map((f, k) => {
      const s = this.shapes[f]!;
      const o = offsets[k]!;
      return new RAPIER.ColliderDesc(s.shape)
        .setTranslation(o.x + s.base.x, o.y + s.base.y, o.z + s.base.z)
        .setDensity(s.density)
        .setFriction(s.friction)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    });
    const desc = (dynamic ? RAPIER.RigidBodyDesc.dynamic() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(position.x, position.y, position.z)
      .setRotation(rotation)
      .setLinvel(linvel.x, linvel.y, linvel.z)
      .setAngvel(angvel);
    const target: SyncTarget =
      frags.length === 1
        ? this.meshes.slots[frags[0]!]!
        : {
            parts: frags.map((f, k): ChunkPart => ({
              slots: this.meshes.slots[f]!,
              offset: offsets[k]!.clone(),
            })),
          };
    const body = this.physics.addCompound(desc, colliders, target);
    const chunk: Chunk = {
      body,
      frags: [...frags],
      offsets: offsets.map((o) => o.clone()),
      volume: frags.reduce((sum, f) => sum + this.fragments[f]!.volume, 0),
      lastVelocity: new Vector3(linvel.x, linvel.y, linvel.z),
    };
    this.chunks.set(body, chunk);
    for (const f of frags) this.chunkOf[f] = chunk;
    return chunk;
  }

  private cancelFade(chunk: Chunk): void {
    const i = this.fading.findIndex((f) => f.chunk === chunk);
    if (i < 0) return;
    this.fading.splice(i, 1);
    const body = chunk.body;
    scratchMatrix.compose(body.currPos, body.currQuat, scratchScale.setScalar(1));
    forEachSlot(body.target, (s) => s.batch.setMatrixAt(s.id, scratchMatrix));
  }
}

/** physics.removeBelow 콜백용: 제거된 바디의 인스턴스를 숨긴다 */
export function hideRemovedFragment(body: PhysicsBody): void {
  forEachSlot(body.target, (s) => s.batch.setVisibleAt(s.id, false));
}

function hullCollider(frag: Fragment): RAPIER.ColliderDesc {
  return (
    RAPIER.ColliderDesc.convexHull(frag.hull) ??
    // 퇴화 hull(사실상 없음) 대비: 같은 부피의 구
    RAPIER.ColliderDesc.ball(Math.cbrt((3 * frag.volume) / (4 * Math.PI)))
  );
}

/** hull의 AABB를 부피가 조각과 같아지게 줄인 cuboid (질량이 원래 조각과 같다) */
function cuboidCollider(frag: Fragment): RAPIER.ColliderDesc {
  const h = frag.hull;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let k = 0; k < h.length; k += 3) {
    minX = Math.min(minX, h[k]!);
    minY = Math.min(minY, h[k + 1]!);
    minZ = Math.min(minZ, h[k + 2]!);
    maxX = Math.max(maxX, h[k]!);
    maxY = Math.max(maxY, h[k + 1]!);
    maxZ = Math.max(maxZ, h[k + 2]!);
  }
  const hx = (maxX - minX) / 2;
  const hy = (maxY - minY) / 2;
  const hz = (maxZ - minZ) / 2;
  const scale = Math.cbrt(frag.volume / (8 * hx * hy * hz));
  return RAPIER.ColliderDesc.cuboid(hx * scale, hy * scale, hz * scale).setTranslation(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  );
}
