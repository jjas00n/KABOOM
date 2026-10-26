// 분할된 물체 하나: 조각 렌더(FragmentMeshes) + 조각별 Rapier convexHull 바디.
// 조각은 처음엔 전부 fixed, activate하면 dynamic. 앵커 조각은 절대 activate되지 않는다.
import RAPIER from '@dimforge/rapier3d-compat';
import type { Intersection, Raycaster, Scene } from 'three';
import { CONCRETE, GLASS } from '../config';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import { FragmentMeshes, type FragmentMaterials } from '../fracture/FragmentMeshes';
import type { Vec3Like } from '../fracture/polyhedron';
import { isBatchSlots, type PhysicsBody, type PhysicsWorld } from '../physics/PhysicsWorld';

export class FragmentSet {
  readonly meshes: FragmentMeshes;
  readonly bodies: PhysicsBody[];
  private readonly hits: Intersection[] = [];

  constructor(
    scene: Scene,
    private readonly physics: PhysicsWorld,
    readonly fragments: readonly Fragment[],
    materials: FragmentMaterials,
    /** 앵커(항상 fixed) 여부. 생략하면 앵커 없음. */
    private readonly isAnchor: (index: number) => boolean = () => false,
  ) {
    this.meshes = new FragmentMeshes(fragments, materials);
    this.bodies = fragments.map((frag, i) => {
      const glass = frag.material === MATERIAL.glass;
      const c = frag.centroid;
      const collider = (
        RAPIER.ColliderDesc.convexHull(frag.hull) ??
        // 퇴화 hull(사실상 없음) 대비: 같은 부피의 구
        RAPIER.ColliderDesc.ball(Math.cbrt((3 * frag.volume) / (4 * Math.PI)))
      )
        .setDensity(glass ? GLASS.density : CONCRETE.density)
        .setFriction(glass ? GLASS.friction : CONCRETE.friction);
      return physics.add(
        RAPIER.RigidBodyDesc.fixed().setTranslation(c.x, c.y, c.z),
        collider,
        this.meshes.slots[i]!,
      );
    });
    for (const batch of this.meshes.batches) scene.add(batch);
  }

  /** fixed → dynamic. 이미 dynamic이거나 앵커면 false. */
  activate(index: number): boolean {
    const body = this.bodies[index]!;
    if (this.isAnchor(index) || !this.physics.has(body) || !body.rigidBody.isFixed()) return false;
    body.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    return true;
  }

  activateAll(): void {
    for (let i = 0; i < this.bodies.length; i++) this.activate(i);
  }

  /** 질량중심이 center에서 radius 안인 조각을 activate. 반환: 새로 활성화된 수 */
  activateWithin(center: Vec3Like, radius: number): number {
    const r2 = radius * radius;
    let n = 0;
    this.bodies.forEach((body, i) => {
      const p = body.currPos;
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const dz = p.z - center.z;
      if (dx * dx + dy * dy + dz * dz <= r2 && this.activate(i)) n++;
    });
    return n;
  }

  /** 가장 가까운 조각 표면 교차 (없으면 undefined) */
  raycast(raycaster: Raycaster): Intersection | undefined {
    this.hits.length = 0;
    raycaster.intersectObjects(this.meshes.batches, false, this.hits);
    return this.hits[0];
  }

  dispose(): void {
    for (const body of this.bodies) this.physics.remove(body);
    this.meshes.dispose();
  }
}

/** physics.removeBelow 콜백용: 제거된 조각의 인스턴스를 숨긴다 */
export function hideRemovedFragment(body: PhysicsBody): void {
  const target = body.target;
  if (!target || !isBatchSlots(target)) return;
  for (const slot of target) slot.batch.setVisibleAt(slot.id, false);
}
