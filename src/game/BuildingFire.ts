// 건물 화재의 연결부: FireSystem(순수 로직) ↔ 파괴 시스템(약화 → 붕괴), 불 파티클, 조각 색, 화재 라이트.
//   step   (물리 시간) 화재 틱 → 엣지 용량이 줄었으면 CollapseSolver에 알림
//   update (렌더 프레임) 타는 조각 중 몇 개를 뽑아 불꽃·연기 방출, 그을음·불씨 색, 큰 화재 구역에 라이트
import { Color, Vector3, type PointLight } from 'three';
import { DURABILITY, FIRE } from '../config';
import { FireSystem } from '../destruction/FireSystem';
import type { DestructionSystem } from '../destruction/DestructionSystem';
import type { Vec3Like } from '../fracture/polyhedron';
import type { Fire } from '../fx/Fire';
import type { LightPool } from '../fx/LightPool';

interface Cell {
  count: number;
  x: number;
  y: number;
  z: number;
}

const at = new Vector3();
const heatColor = new Color();
const COLD = new Color(0x2040ff);
const HOT = new Color(0xff2010);

export class BuildingFire {
  readonly system: FireSystem;
  /** 타는 조각들의 무게중심 (관람 카메라용). 안 타면 마지막 값 */
  readonly center = new Vector3();
  /** 디버그: 조각 색을 heat로 칠한다 */
  heatmap = false;

  private readonly painted: Uint8Array;
  private readonly lights: (PointLight | null)[] = [];
  private readonly cells = new Map<number, Cell>();
  private visualAcc = 0;
  /** 화재 내구도 감소 틱 누적 (물리 시간) */
  private wearAcc = 0;
  private ticks = 0;
  private time = 0;

  /** kind: 노드의 부재 종류 (연료·슬래브 판정), random: 연료 변주용 */
  constructor(
    private readonly destruction: DestructionSystem,
    kind: (node: number) => string,
    private readonly particles: Fire,
    private readonly pool: LightPool,
    random: () => number,
  ) {
    const graph = destruction.graph;
    const slab = new Uint8Array(graph.nodeCount);
    for (let i = 0; i < graph.nodeCount; i++) slab[i] = kind(i) === 'slab' ? 1 : 0;
    this.system = new FireSystem(
      graph,
      destruction.positions,
      FireSystem.fuelFor(graph, kind, random),
      slab,
    );
    this.painted = new Uint8Array(graph.nodeCount);
    const frags = destruction.fragments;
    this.system.isSettled = (i) => {
      const chunk = frags.chunkOf[i];
      if (!chunk) return true; // 제거됨
      const rb = chunk.body.rigidBody;
      return !rb.isDynamic() || rb.isSleeping();
    };
  }

  get burningCount(): number {
    return this.system.burningCount;
  }

  /** 화염 폭발: 반경 안을 데운다 (착화는 다음 틱) */
  ignite(center: Vec3Like, radius: number, heat: number): void {
    this.system.addHeat(center, radius, heat);
    if (this.system.burningCount === 0) this.center.set(center.x, center.y, center.z);
  }

  /** 대포 폭발: 근처가 타고 있으면 불씨가 튀어 주변을 더 데운다 */
  cannonBlast(center: Vec3Like): void {
    if (!this.system.burningNear(center, FIRE.cannonEmberRadius)) return;
    this.system.addHeat(center, FIRE.cannonEmberRadius, FIRE.cannonEmberHeat);
    for (let i = 0; i < 30; i++) this.particles.ember(center, FIRE.emberSpeed * 3);
  }

  extinguish(): void {
    this.system.extinguishAll();
  }

  /** 고정 timestep마다 (물리 시간) */
  step(dt: number): void {
    const r = this.system.update(dt);
    if (r.weakened) this.destruction.solver.capacityChanged();
    this.wearAcc += dt;
    if (this.wearAcc >= DURABILITY.fireTickSec) {
      this.wearAcc -= DURABILITY.fireTickSec;
      this.destruction.wearBurning(this.system.burningNodes);
    }
  }

  /** 렌더 프레임마다. physicsDt: 물리 배속이 반영된 경과 시간 */
  update(physicsDt: number): void {
    this.time += physicsDt;
    this.visualAcc += physicsDt;
    if (this.visualAcc >= FIRE.tickSec) {
      this.visualAcc %= FIRE.tickSec;
      this.ticks++;
      this.emit();
      this.paint();
      this.placeLights();
    }
    this.flickerLights();
  }

  /** 라이트를 돌려주고 색을 원래대로 (건물 재생성 전) */
  dispose(): void {
    for (const l of this.lights) this.pool.release(l);
    this.lights.length = 0;
    this.destruction.fragments.meshes.resetTints();
  }

  /** 조각 i의 지금 월드 위치 (서 있으면 원래 자리, 떨어졌으면 덩어리 변환) */
  private positionOf(i: number, out: Vector3): Vector3 | null {
    const d = this.destruction;
    if (d.graph.attached[i]) {
      const p = d.positions;
      return out.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
    }
    const chunk = d.fragments.chunkOf[i];
    if (!chunk) return null;
    const k = chunk.frags.indexOf(i);
    return out.copy(chunk.offsets[k]!).applyQuaternion(chunk.body.currQuat).add(chunk.body.currPos);
  }

  private emit(): void {
    const list = this.system.burningNodes;
    if (list.length === 0) return;
    const smoke = this.ticks % FIRE.smokeEvery === 0;
    const n = Math.min(FIRE.sampleEmitters, list.length);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let top = -Infinity;
    let count = 0;
    for (let k = 0; k < n; k++) {
      const i = list[Math.floor(Math.random() * list.length)]!;
      if (!this.positionOf(i, at)) continue;
      this.particles.flame(at, 0.6 + 0.4 * Math.random(), smoke && k % 4 === 0);
      sx += at.x;
      sy += at.y;
      sz += at.z;
      top = Math.max(top, at.y);
      count++;
    }
    if (count === 0) return;
    this.center.set(sx / count, sy / count, sz / count);
    // 연기 기둥: 화재 구역 위에서 크고 오래 사는 연기
    for (let k = 0; k < FIRE.plumePerTick; k++) {
      at.set(
        this.center.x + (Math.random() - 0.5) * 3,
        top + 1,
        this.center.z + (Math.random() - 0.5) * 3,
      );
      this.particles.smokePuff(at, FIRE.plumeSize * (0.7 + 0.6 * Math.random()));
    }
  }

  /** 그을음(RGB) + 불씨(알파). 타는 조각과 이번에 꺼진 조각만 다시 칠한다 */
  private paint(): void {
    const { burning, charred, fuel, heat } = this.system;
    const meshes = this.destruction.fragments.meshes;
    const t = FIRE.charTint;
    const n = this.painted.length;
    if (this.heatmap) {
      meshes.overlay = true;
      for (let i = 0; i < n; i++) {
        heatColor.lerpColors(COLD, HOT, heat[i]!);
        if (burning[i]) heatColor.setRGB(1, 1, 0.3);
        for (const { batch, id } of meshes.slots[i]!) batch.setColorAt(id, heatColor);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (!burning[i] && !this.painted[i]) continue;
      const c = charred[i]!;
      const ember = burning[i] ? 0.4 + 0.6 * Math.min(1, fuel[i]! / 3) : 0;
      meshes.setTint(i, 1 + (t.r - 1) * c, 1 + (t.g - 1) * c, 1 + (t.b - 1) * c, 1 - ember);
      this.painted[i] = burning[i]!;
    }
  }

  /** 디버그 히트맵을 끈 뒤 기본색으로 */
  restoreColors(): void {
    const meshes = this.destruction.fragments.meshes;
    meshes.overlay = false;
    meshes.restoreTints();
  }

  /** 타는 조각을 lightCell 격자로 묶어 가장 큰 구역들에 라이트 */
  private placeLights(): void {
    const list = this.system.burningNodes;
    const cells = this.cells;
    cells.clear();
    const s = FIRE.lightCell;
    for (const i of list) {
      if (!this.destruction.graph.attached[i]) continue; // 떨어진 조각은 생략
      const p = this.destruction.positions;
      const x = p[i * 3]!;
      const y = p[i * 3 + 1]!;
      const z = p[i * 3 + 2]!;
      const key =
        ((Math.floor(x / s) + 512) * 1024 + Math.floor(y / s) + 512) * 1024 +
        Math.floor(z / s) +
        512;
      const cell = cells.get(key);
      if (cell) {
        cell.count++;
        cell.x += x;
        cell.y += y;
        cell.z += z;
      } else cells.set(key, { count: 1, x, y, z });
    }
    const best = [...cells.values()].sort((a, b) => b.count - a.count).slice(0, FIRE.lights);
    for (let k = 0; k < FIRE.lights; k++) {
      const cell = best[k];
      if (!cell) {
        this.pool.release(this.lights[k] ?? null);
        this.lights[k] = null;
        continue;
      }
      let light = this.lights[k] ?? null;
      if (!light) {
        light = this.pool.acquire();
        if (!light) continue;
        light.color.set(FIRE.lightColor);
        light.distance = FIRE.lightDistance;
        this.lights[k] = light;
      }
      light.position.set(cell.x / cell.count, cell.y / cell.count + 0.5, cell.z / cell.count);
      light.userData.strength = Math.min(1, cell.count / 12);
    }
  }

  private flickerLights(): void {
    this.lights.forEach((light, k) => {
      if (!light) return;
      const f =
        0.75 +
        0.15 * Math.sin(this.time * FIRE.lightFlickerHz * 6.28 + k * 1.7) +
        0.1 * Math.sin(this.time * FIRE.lightFlickerHz * 15.1 + k);
      light.intensity = FIRE.lightIntensity * ((light.userData.strength as number) ?? 0) * f;
    });
  }
}
