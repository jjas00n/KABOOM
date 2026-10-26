// 건물 데모: 절차적 건물 생성 → 부재별 사전 분할(워커) → 구조 그래프 + 조각 물리.
// 클릭하면 그 지점에 포탄 1발 상당의 에너지로 폭발 → 지지 잃은 부분이 덩어리로 무너진다.
import { Raycaster, Vector2, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  generateBuilding,
  DEFAULT_BUILDING,
  type BuildingParams,
} from '../building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../building/seedBudget';
import {
  BUILDING,
  BUILDING_DEMO,
  DEBRIS,
  DEFAULT_QUALITY,
  STRUCTURE,
  type QualityPreset,
} from '../config';
import type { Renderer } from '../core/Renderer';
import { DestructionSystem, type DestructionStats } from '../destruction/DestructionSystem';
import { StructureDebug } from '../destruction/StructureDebug';
import { fractureInWorker } from '../fracture/FractureJob';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import { createFragmentMaterials } from '../fracture/FragmentMeshes';
import type { Aabb } from '../fracture/polyhedron';
import { createRng } from '../fracture/seeds';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { createStage, onCanvasClick } from './Stage';

/** 분할(워커)이 진행률 바에서 차지하는 비율. 나머지는 메시/바디/그래프 생성. */
const FRACTURE_PROGRESS_SHARE = 0.9;

/** 건물 외벽 한 면: 바깥쪽 법선이 axis 축의 sign 방향 */
export interface Facade {
  axis: 'x' | 'z';
  sign: 1 | -1;
}
const MINUS_Z: Facade = { axis: 'z', sign: -1 };
const PLUS_X: Facade = { axis: 'x', sign: 1 };
const ALL_FACADES: readonly Facade[] = [
  MINUS_Z,
  PLUS_X,
  { axis: 'z', sign: 1 },
  { axis: 'x', sign: -1 },
];
const CLADDING: readonly string[] = STRUCTURE.cladding;

export class BuildingDemo {
  readonly settings: BuildingParams & { quality: QualityPreset } = {
    ...DEFAULT_BUILDING,
    quality: DEFAULT_QUALITY,
  };
  readonly stats = { members: 0, fragments: 0, edges: 0, loadMs: 0 };
  /** GUI가 붙잡는 고정 객체. 건물을 새로 만들어도 같은 객체에 값을 복사한다. */
  readonly destructionStats: DestructionStats = {
    islands: 0,
    shatters: 0,
    chainBreaks: 0,
    overloaded: 0,
    compounds: 0,
    frozen: 0,
    fading: 0,
  };
  debugColors = false;
  showGraph = false;

  private readonly controls: OrbitControls;
  private readonly materials = createFragmentMaterials();
  private destruction: DestructionSystem | null = null;
  private graphDebug: StructureDebug | null = null;
  private footprint: Aabb | null = null;
  /** reset이 겹쳐 들어오면 늦게 끝난 이전 생성 결과를 버리기 위한 세대 번호 */
  private generation = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly position = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly physics: PhysicsWorld,
    private readonly loading: LoadingOverlay,
  ) {
    this.controls = createStage(
      renderer,
      physics,
      BUILDING_DEMO.cameraPosition,
      BUILDING_DEMO.cameraTarget,
    );
    onCanvasClick(renderer.canvas, (x, y) => {
      this.pointer.set(x, y);
      this.explodeAtPointer();
    });
    this.reset();
  }

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.destruction?.step(dt);
  }

  update(dt: number): void {
    this.controls.update();
    const d = this.destruction;
    if (!d) return;
    this.physics.removeBelow(DEBRIS.killY, (body) => d.forget(body));
    d.update(dt);
    Object.assign(this.destructionStats, d.stats);
    this.graphDebug?.update(dt);
  }

  /** 현재 설정으로 건물을 새로 생성한다 */
  reset(): void {
    this.build().catch((err: unknown) => {
      console.error('building generation failed', err);
      this.loading.hide();
    });
  }

  setDebugColors(enabled: boolean): void {
    this.debugColors = enabled;
    this.destruction?.fragments.meshes.setDebugColors(enabled, BUILDING_DEMO.debugColorSeed);
  }

  setShowGraph(enabled: boolean): void {
    this.showGraph = enabled;
    this.graphDebug?.setEnabled(enabled);
  }

  private async build(): Promise<void> {
    const generation = ++this.generation;
    this.graphDebug?.dispose();
    this.graphDebug = null;
    this.destruction?.dispose();
    this.destruction = null;
    const started = performance.now();
    this.loading.show('Generating building…');

    const { quality, ...params } = this.settings;
    const { members, footprint } = generateBuilding(params);
    this.footprint = footprint;
    const counts = seedCountsForPreset(members, quality);
    const rng = createRng(params.seed);
    const jobs = members.map((m, i) => ({
      box: m.box,
      seeds: memberSeeds(m, counts[i]!, rng),
      material: m.kind === 'glass' ? MATERIAL.glass : MATERIAL.concrete,
    }));

    const frags = await fractureInWorker({ jobs }, (done, total) =>
      this.loading.progress(
        (done / total) * FRACTURE_PROGRESS_SHARE,
        `Fracturing ${members.length} members… ${done}/${total}`,
      ),
    );
    if (generation !== this.generation) return;

    this.loading.progress(FRACTURE_PROGRESS_SHARE, `Building ${frags.length} fragments…`);
    await nextFrame(); // 진행률 표시가 그려진 뒤 무거운 메인 스레드 작업
    if (generation !== this.generation) return;

    const member = (i: number) => members[frags[i]!.member]!;
    const d = new DestructionSystem(
      this.renderer.scene,
      this.physics,
      frags,
      this.materials,
      (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
      volumePercentile(frags, DEBRIS.simpleColliderPercentile),
    );
    this.destruction = d;
    this.graphDebug = new StructureDebug(this.renderer.scene, d.graph, d.positions);
    this.graphDebug.setEnabled(this.showGraph);
    if (this.debugColors) this.setDebugColors(true);

    this.stats.members = members.length;
    this.stats.fragments = frags.length;
    this.stats.edges = d.graph.edgeCount;
    this.stats.loadMs = Math.round(performance.now() - started);
    this.loading.hide();
  }

  /**
   * 성능 측정용 재현 시나리오: 모든 층의 주어진 외벽들(기본: -z면, +x면) 칸 중앙을 한꺼번에 폭파.
   * 같은 건물 설정이면 매번 같은 결과.
   */
  smashTest(facades: readonly Facade[] = [MINUS_Z, PLUS_X]): void {
    const d = this.destruction;
    if (!d || !this.footprint) return;
    const { floors, floorHeight } = this.settings;
    const random = createRng(BUILDING_DEMO.smashSeed);
    for (let f = 0; f < floors; f++) {
      const y = BUILDING.foundationThickness + (f + 0.5) * floorHeight;
      for (const facade of facades) {
        const bays = this.baysAlong(facade);
        for (let i = 0; i < bays; i++) {
          this.pointOnFacade(facade, (i + 0.5) / bays, 0, y, this.position);
          d.detonate(this.position, BUILDING_DEMO.smashEnergy, random);
        }
      }
    }
  }

  /** 붕괴 확인 시나리오: 주어진 외벽(기본: -z면)의 1층 기둥 줄을 작은 폭발로 하나씩 날린다 */
  pullColumns(facade: Facade = MINUS_Z): void {
    const d = this.destruction;
    if (!d || !this.footprint) return;
    const half = BUILDING.columnSize / 2;
    const y = BUILDING.foundationThickness + this.settings.floorHeight * 0.4;
    const bays = this.baysAlong(facade);
    for (let i = 0; i <= bays; i++) {
      // 기둥 중심: 양 끝은 외곽에서 half 안쪽, 사이는 같은 간격
      this.pointOnFacade(facade, i / bays, half, y, this.position);
      d.detonate(this.position, BUILDING_DEMO.columnEnergy);
    }
  }

  /** 카메라가 보고 있는 외벽들 (카메라 쪽을 향한 면, 정면에 가까운 순) */
  viewedFacades(): Facade[] {
    if (!this.footprint) return [];
    const { min, max } = this.footprint;
    const cam = this.renderer.camera.position;
    // 건물 중심에서 카메라로의 방향을 외곽 크기로 정규화 (길쭉한 건물에서도 보이는 면 기준이 되게)
    const dx = (cam.x - (min.x + max.x) / 2) / ((max.x - min.x) / 2);
    const dz = (cam.z - (min.z + max.z) / 2) / ((max.z - min.z) / 2);
    return ALL_FACADES.map((f) => ({ f, dot: f.axis === 'x' ? f.sign * dx : f.sign * dz }))
      .filter((e) => e.dot > 0)
      .sort((a, b) => b.dot - a.dot)
      .map((e) => e.f);
  }

  /** Smash test를 지금 보이는 외벽들에 */
  smashViewed(): void {
    this.smashTest(this.viewedFacades());
  }

  /** Pull columns를 지금 가장 정면으로 보이는 외벽에 */
  pullViewed(): void {
    const facade = this.viewedFacades()[0];
    if (facade) this.pullColumns(facade);
  }

  private baysAlong(facade: Facade): number {
    return facade.axis === 'z' ? this.settings.baysX : this.settings.baysZ;
  }

  /**
   * 외벽 위의 점. inset = 외곽에서 안쪽으로 들어간 거리 (면 방향과 양 끝 모두).
   * t = 0 ~ 1: inset 0이면 외곽 끝~끝, inset = 기둥 반폭이면 양 끝 기둥 중심~중심.
   */
  private pointOnFacade(
    facade: Facade,
    t: number,
    inset: number,
    y: number,
    out: Vector3,
  ): Vector3 {
    const { min, max } = this.footprint!;
    const [a, b] = facade.axis === 'z' ? [min.x, max.x] : [min.z, max.z];
    const along = a + inset + t * (b - a - 2 * inset);
    const face =
      facade.axis === 'z' ? (facade.sign > 0 ? max.z : min.z) : facade.sign > 0 ? max.x : min.x;
    const plane = face - facade.sign * inset;
    return facade.axis === 'z' ? out.set(along, y, plane) : out.set(plane, y, along);
  }

  private explodeAtPointer(): void {
    const d = this.destruction;
    if (!d) return;
    this.raycaster.setFromCamera(this.pointer, this.renderer.camera);
    const hit = d.fragments.raycast(this.raycaster);
    if (!hit) return;
    d.detonate(this.position.copy(hit.point), BUILDING_DEMO.clickEnergy);
  }
}

/** 조각 부피의 하위 p 분위수 (p <= 0이면 0 → 단순 콜라이더 끔) */
function volumePercentile(frags: readonly Fragment[], p: number): number {
  if (p <= 0 || frags.length === 0) return 0;
  const sorted = frags.map((f) => f.volume).sort((a, b) => a - b);
  return sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)]!;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
