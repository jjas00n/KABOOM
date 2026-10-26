// 건물 한 채의 수명: 절차적 생성 → 부재별 사전 분할(워커) → 구조 그래프 + 조각 물리 → 파괴.
// 게임(Game)과 디버그 샌드박스(BuildingDemo)가 같이 쓴다. 카메라/입력은 모른다.
import type { Scene, Vector3 } from 'three';
import {
  generateBuilding,
  DEFAULT_BUILDING,
  type BuildingParams,
} from '../building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../building/seedBudget';
import { BUILDING_DEMO, DEBRIS, DEFAULT_QUALITY, STRUCTURE, type QualityPreset } from '../config';
import { DestructionSystem, type DestructionStats } from '../destruction/DestructionSystem';
import { StructureDebug } from '../destruction/StructureDebug';
import { fractureInWorker } from '../fracture/FractureJob';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import { createFragmentMaterials, type FragmentMaterials } from '../fracture/FragmentMeshes';
import type { Aabb } from '../fracture/polyhedron';
import { createRng } from '../fracture/seeds';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { LoadingOverlay } from '../ui/LoadingOverlay';

/** 분할(워커)이 진행률 바에서 차지하는 비율. 나머지는 메시/바디/그래프 생성. */
const FRACTURE_PROGRESS_SHARE = 0.9;
const CLADDING: readonly string[] = STRUCTURE.cladding;

export class BuildingSite {
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
  /** 기둥 바깥면까지의 외곽 (생성 전 null) */
  footprint: Aabb | null = null;
  /** 난간 꼭대기 높이 */
  height = 0;

  private readonly materials = createFragmentMaterials();
  private system: DestructionSystem | null = null;
  private graphDebug: StructureDebug | null = null;
  /** reset이 겹쳐 들어오면 늦게 끝난 이전 생성 결과를 버리기 위한 세대 번호 */
  private generation = 0;

  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly loading: LoadingOverlay,
  ) {}

  /** 조각 재질 3종 (엑스레이 화면이 잠깐 바꾼다) */
  get fragmentMaterials(): FragmentMaterials {
    return this.materials;
  }

  /** 조각 색을 지금 설정(디버그 색칠 여부)대로 다시 칠한다 */
  restoreColors(): void {
    this.system?.fragments.meshes.setDebugColors(this.debugColors, BUILDING_DEMO.debugColorSeed);
  }

  /** 생성이 끝난 건물의 파괴 시스템 (생성 중이면 null) */
  get destruction(): DestructionSystem | null {
    return this.system;
  }

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.system?.step(dt);
  }

  /** 렌더 프레임마다 */
  update(dt: number): void {
    const d = this.system;
    if (!d) return;
    this.physics.removeBelow(DEBRIS.killY, (body) => d.forget(body));
    d.update(dt);
    Object.assign(this.destructionStats, d.stats);
    this.graphDebug?.update(dt);
  }

  /** 지정 지점에 에너지(J)만큼 폭발. 반환: 파괴 반경 (건물이 없으면 0) */
  detonate(point: Vector3, energy: number, random?: () => number): number {
    return this.system?.detonate(point, energy, random) ?? 0;
  }

  setDebugColors(enabled: boolean): void {
    this.debugColors = enabled;
    this.system?.fragments.meshes.setDebugColors(enabled, BUILDING_DEMO.debugColorSeed);
  }

  setShowGraph(enabled: boolean): void {
    this.showGraph = enabled;
    this.graphDebug?.setEnabled(enabled);
  }

  /**
   * 현재 설정으로 건물을 새로 만든다. 반환: 이 호출이 끝까지 반영됐으면 true
   * (도중에 다시 reset이 불려 버려졌으면 false).
   */
  async reset(): Promise<boolean> {
    try {
      return await this.build();
    } catch (err) {
      console.error('building generation failed', err);
      this.loading.hide();
      return false;
    }
  }

  private async build(): Promise<boolean> {
    const generation = ++this.generation;
    this.graphDebug?.dispose();
    this.graphDebug = null;
    this.system?.dispose();
    this.system = null;
    const started = performance.now();
    this.loading.show('Generating building…');

    const { quality, ...params } = this.settings;
    const { members, footprint, height } = generateBuilding(params);
    this.footprint = footprint;
    this.height = height;
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
    if (generation !== this.generation) return false;

    this.loading.progress(FRACTURE_PROGRESS_SHARE, `Building ${frags.length} fragments…`);
    await nextFrame(); // 진행률 표시가 그려진 뒤 무거운 메인 스레드 작업
    if (generation !== this.generation) return false;

    const member = (i: number) => members[frags[i]!.member]!;
    const d = new DestructionSystem(
      this.scene,
      this.physics,
      frags,
      this.materials,
      (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
      volumePercentile(frags, DEBRIS.simpleColliderPercentile),
    );
    this.system = d;
    this.graphDebug = new StructureDebug(this.scene, d.graph, d.positions);
    this.graphDebug.setEnabled(this.showGraph);
    if (this.debugColors) this.setDebugColors(true);

    this.stats.members = members.length;
    this.stats.fragments = frags.length;
    this.stats.edges = d.graph.edgeCount;
    this.stats.loadMs = Math.round(performance.now() - started);
    this.loading.hide();
    return true;
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
