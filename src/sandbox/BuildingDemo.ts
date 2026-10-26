// Phase 3 건물 데모: 절차적 건물 생성 → 부재별 사전 분할(워커) → 조각 렌더 + fixed 바디.
// 클릭하면 그 주변 조각만 dynamic + 폭발 (지지 상실 연쇄 붕괴는 Phase 4).
import { Raycaster, Vector2, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  generateBuilding,
  DEFAULT_BUILDING,
  type BuildingParams,
} from '../building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../building/seedBudget';
import { BUILDING_DEMO, DEBRIS, DEFAULT_QUALITY, type QualityPreset } from '../config';
import type { Renderer } from '../core/Renderer';
import { applyExplosion } from '../destruction/Explosion';
import { FragmentSet, hideRemovedFragment } from '../destruction/FragmentSet';
import { fractureInWorker } from '../fracture/FractureJob';
import { MATERIAL } from '../fracture/Fragment';
import { createFragmentMaterials } from '../fracture/FragmentMeshes';
import { createRng } from '../fracture/seeds';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { createStage, onCanvasClick } from './Stage';

/** 분할(워커)이 진행률 바에서 차지하는 비율. 나머지는 메시/바디 생성. */
const FRACTURE_PROGRESS_SHARE = 0.9;

export class BuildingDemo {
  readonly settings: BuildingParams & { quality: QualityPreset } = {
    ...DEFAULT_BUILDING,
    quality: DEFAULT_QUALITY,
  };
  readonly stats = { members: 0, fragments: 0, loadMs: 0 };
  debugColors = false;

  private readonly controls: OrbitControls;
  private readonly materials = createFragmentMaterials();
  private fragments: FragmentSet | null = null;
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

  update(): void {
    this.controls.update();
    this.physics.removeBelow(DEBRIS.killY, hideRemovedFragment);
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
    this.fragments?.meshes.setDebugColors(enabled, BUILDING_DEMO.debugColorSeed);
  }

  private async build(): Promise<void> {
    const generation = ++this.generation;
    this.fragments?.dispose();
    this.fragments = null;
    const started = performance.now();
    this.loading.show('Generating building…');

    const { quality, ...params } = this.settings;
    const { members } = generateBuilding(params);
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

    this.fragments = new FragmentSet(
      this.renderer.scene,
      this.physics,
      frags,
      this.materials,
      (i) => members[frags[i]!.member]!.anchor,
    );
    if (this.debugColors) this.setDebugColors(true);

    this.stats.members = members.length;
    this.stats.fragments = frags.length;
    this.stats.loadMs = Math.round(performance.now() - started);
    this.loading.hide();
  }

  private explodeAtPointer(): void {
    if (!this.fragments) return;
    this.raycaster.setFromCamera(this.pointer, this.renderer.camera);
    const hit = this.fragments.raycast(this.raycaster);
    if (!hit) return;

    this.position.copy(hit.point);
    const radius = BUILDING_DEMO.explosionRadius;
    this.fragments.activateWithin(this.position, radius);
    applyExplosion(this.fragments.bodies, this.position, { radius });
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
