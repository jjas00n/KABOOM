// 건물 한 채의 수명: 절차적 생성 → 부재별 사전 분할(워커) → 구조 그래프 + 조각 물리 → 파괴·화재 (+ 이펙트).
// 게임(Game)과 디버그 샌드박스(BuildingDemo)가 같이 쓴다. 카메라/입력은 모른다.
// 손상 외관(DamageView: 틈·균열·흔들림, Rebar: 철근)과 불변 조건 검사도 여기서 돌린다.
import { Color, type Scene, type Vector3 } from 'three';
import {
  generateBuilding,
  DEFAULT_BUILDING,
  type BuildingParams,
} from '../building/BuildingGenerator';
import { memberSeeds, seedCountsForPreset } from '../building/seedBudget';
import {
  BUILDING_DEMO,
  DAMAGE_VISUAL,
  DEBRIS,
  DURABILITY,
  DEFAULT_QUALITY,
  FIRE,
  FIREBALL,
  GLASS,
  STRUCTURE,
  type GlassMode,
  type QualityPreset,
} from '../config';
import type { Assets } from '../core/Assets';
import { DamageView } from '../destruction/DamageView';
import { DestructionSystem, type DestructionStats } from '../destruction/DestructionSystem';
import { Durability } from '../destruction/Durability';
import { checkInvariants, violationCount } from '../destruction/Invariants';
import { StructureDebug } from '../destruction/StructureDebug';
import { fractureInWorker } from '../fracture/FractureJob';
import { MATERIAL, type Fragment } from '../fracture/Fragment';
import {
  createFragmentMaterials,
  setGlassMode,
  type FragmentMaterials,
} from '../fracture/FragmentMeshes';
import type { Aabb } from '../fracture/polyhedron';
import { createRng } from '../fracture/seeds';
import { Effects } from '../fx/Effects';
import { LightPool } from '../fx/LightPool';
import { Rebar } from '../fx/Rebar';
import { ColliderOverlay } from '../physics/ColliderOverlay';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { BuildingFire } from './BuildingFire';
import { fireballProfile } from './fireball';
import type { TimeControl } from './Game';

/** 분할(워커)이 진행률 바에서 차지하는 비율. 나머지는 메시/바디/그래프 생성. */
const FRACTURE_PROGRESS_SHARE = 0.9;
const CLADDING: readonly string[] = STRUCTURE.cladding;
/** 디버그 damage 히트맵 다시 칠하는 주기 (실제 시간) */
const HEATMAP_SEC = 0.25;
const HEAT_LOW = new Color(0x30c060);
const HEAT_HIGH = new Color(0xff2020);
const heat = new Color();
/** 내구도 히트맵에서 빨강이 되는 내구도 */
const DURABILITY_HEAT_MAX = 4;

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
    durabilityHits: 0,
    looseDrops: 0,
    overloaded: 0,
    compounds: 0,
    frozen: 0,
    fading: 0,
  };
  debugColors = false;
  showGraph = false;
  /** 유리 렌더 방식. 바꾼 뒤 applyGlassMode() */
  glassMode: GlassMode = GLASS.defaultMode;
  readonly effects: Effects;
  /** 포인트 라이트 풀 (파이어볼·마법사·화재가 나눠 쓴다) */
  readonly lights: LightPool;
  readonly fireStats = { burning: 0 };
  /** 손상 외관·불변 조건 통계 (GUI) */
  readonly damageStats = {
    teleports: 0,
    uploads: 0,
    pending: 0,
    violations: 0,
    maxRenderErrorMm: 0,
  };
  /** 손상 외관 효과 (틈·처짐·균열·열화·흔들림·철근) */
  damageEffects: boolean = DAMAGE_VISUAL.enabled;
  showColliders = false;
  damageHeatmap = false;
  /** 피날레 진행 중 (불변 조건 검사를 쉰다) */
  finaleActive = false;
  /** 디버그: 조각 색을 남은 내구도로 (0 초록 → 높음 빨강) */
  durabilityHeatmap = false;
  /** 내구도 켬/끔 (비교·측정용, 지금 건물에 바로 적용) */
  durabilityEnabled: boolean = DURABILITY.enabled;
  /** 기둥 바깥면까지의 외곽 (생성 전 null) */
  footprint: Aabb | null = null;
  /** 난간 꼭대기 높이 */
  height = 0;
  /** 조각별 부재 종류 (foundation, wallPanel, …). 생성 전 빈 배열 */
  private kinds: string[] = [];

  private readonly materials: FragmentMaterials;
  private builtQuality: QualityPreset | null = null;
  private system: DestructionSystem | null = null;
  private burning: BuildingFire | null = null;
  private heatmap = false;
  /** 화재 확산 속도 배율 (디버그) */
  spreadMultiplier: number = FIRE.spreadMultiplier;
  private graphDebug: StructureDebug | null = null;
  private damageView: DamageView | null = null;
  private readonly rebar: Rebar;
  private readonly colliders: ColliderOverlay;
  private rebarRevision = -1;
  private rebarAcc = 0;
  private invariantAcc = 0;
  private heatmapAcc = 0;
  /** 이 건물에서 불변 조건 경고를 이미 띄웠는지 (콘솔 도배 방지) */
  private warned = false;
  /** reset이 겹쳐 들어오면 늦게 끝난 이전 생성 결과를 버리기 위한 세대 번호 */
  private generation = 0;

  /** 건물 외곽 + 높이 (그림자 범위 등). 생성 전 null */
  private readonly box: Aabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };

  /**
   * assets: 텍스처 (없으면 단색). ground: 지면 바디 (조각 지면 충돌 이펙트용).
   * time: 파티클 시계를 물리 배속(hit-stop 등)에 맞추기 위한 시간 배속.
   */
  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly loading: LoadingOverlay,
    assets: Assets | null = null,
    private readonly ground: PhysicsBody | null = null,
    private readonly time: TimeControl | null = null,
  ) {
    this.materials = createFragmentMaterials(assets, this.glassMode);
    this.effects = new Effects(scene, this.settings.quality);
    this.lights = new LightPool(scene);
    this.rebar = new Rebar(scene);
    this.colliders = new ColliderOverlay(scene, physics);
  }

  /** 건물 외곽(기둥 바깥면) × 지면~난간 꼭대기. 생성 전 null */
  get bounds(): Aabb | null {
    const f = this.footprint;
    if (!f) return null;
    Object.assign(this.box.min, f.min, { y: 0 });
    Object.assign(this.box.max, f.max, { y: this.height });
    return this.box;
  }

  applyGlassMode(): void {
    setGlassMode(this.materials.glass, this.glassMode);
  }

  /** 조각 재질 3종 (엑스레이 화면이 잠깐 바꾼다) */
  get fragmentMaterials(): FragmentMaterials {
    return this.materials;
  }

  /** 조각 색을 지금 설정(디버그 색칠 여부)대로 다시 칠한다 */
  restoreColors(): void {
    this.system?.fragments.meshes.setDebugColors(this.debugColors, BUILDING_DEMO.debugColorSeed);
  }

  /** 조각 i의 부재 종류 */
  kindOf(i: number): string {
    return this.kinds[i] ?? '';
  }

  /** 건물 화재 (생성 중이면 null) */
  get fire(): BuildingFire | null {
    return this.burning;
  }

  /** 생성이 끝난 건물의 파괴 시스템 (생성 중이면 null) */
  get destruction(): DestructionSystem | null {
    return this.system;
  }

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.system?.step(dt);
    this.burning?.step(dt);
  }

  /** 렌더 프레임마다 */
  update(dt: number): void {
    const physicsDt = dt * (this.time?.timeScale ?? 1);
    this.effects.update(physicsDt);
    this.materials.fireTime.value += physicsDt;
    this.burning?.update(physicsDt);
    this.fireStats.burning = this.burning?.burningCount ?? 0;
    const d = this.system;
    if (!d) return;
    this.physics.removeBelow(DEBRIS.killY, (body) => d.forget(body));
    d.update(dt);
    Object.assign(this.destructionStats, d.stats);
    this.graphDebug?.update(dt);
    this.updateDamage(dt, d);
  }

  /** 손상 외관 적용, 철근 재배치, 불변 조건 검사, 디버그 표시 */
  private updateDamage(dt: number, d: DestructionSystem): void {
    const view = this.damageView;
    if (view) {
      view.update();
      Object.assign(this.damageStats, view.stats);
      this.rebarAcc += dt;
      // 철근은 손상 자세가 다 반영된 뒤, updateSec마다만
      if (
        view.revision !== this.rebarRevision &&
        view.stats.pending === 0 &&
        this.rebarAcc >= DAMAGE_VISUAL.updateSec
      ) {
        this.rebarAcc = 0;
        this.rebarRevision = view.revision;
        if (this.damageEffects) this.rebar.rebuild(d, view.offsets);
        else this.rebar.clear();
      }
    }
    const shown = this.colliders.update(dt, d);
    this.invariantAcc += dt;
    // 피날레 중엔 렌더 전용 진동·대량 정리로 일부러 어긋나므로 검사를 쉰다
    if (!this.finaleActive && (shown || this.invariantAcc >= DAMAGE_VISUAL.invariantCheckSec)) {
      this.invariantAcc = 0;
      const report = shown ?? checkInvariants(d);
      this.damageStats.violations = violationCount(report);
      this.damageStats.maxRenderErrorMm = Math.round(report.maxRenderError * 1000);
      if (this.damageStats.violations > 0 && !this.warned) {
        this.warned = true;
        console.warn('destruction invariants violated', {
          noCollider: report.noCollider.length,
          unhittable: report.unhittable.length,
          stranded: report.stranded.length,
          misaligned: report.misaligned.length,
        });
      }
    }
    if (this.damageHeatmap || this.durabilityHeatmap) {
      this.heatmapAcc += dt;
      if (this.heatmapAcc >= HEATMAP_SEC) {
        this.heatmapAcc = 0;
        const meshes = d.fragments.meshes;
        const cur = d.durability.current;
        meshes.overlay = true;
        meshes.slots.forEach((slots, i) => {
          const t = this.durabilityHeatmap
            ? Math.min(1, cur[i]! / DURABILITY_HEAT_MAX)
            : d.damage.damage[i]!;
          heat.lerpColors(HEAT_LOW, HEAT_HIGH, t);
          for (const { batch, id } of slots) batch.setColorAt(id, heat);
        });
      }
    }
  }

  /** 손상 외관 효과 켜고 끄기 (전후 비교) */
  setDamageEffects(enabled: boolean): void {
    this.damageEffects = enabled;
    this.damageView?.setEnabled(enabled);
    this.rebarRevision = -1;
  }

  /** 디버그: Rapier 콜라이더 와이어프레임 + 불변 조건 위반 조각 표시 */
  setShowColliders(enabled: boolean): void {
    this.showColliders = enabled;
    this.colliders.setEnabled(enabled);
  }

  /** 피날레 연출: 균열 하한(0~1)과 진동 진폭(m) */
  setFinaleLook(crack: number, quake: number): void {
    this.materials.crackFloor.value = crack;
    this.materials.quake.value = quake;
  }

  /** 디버그: 조각 색을 damage로 (초록 0 → 빨강 1) */
  setDamageHeatmap(enabled: boolean): void {
    this.damageHeatmap = enabled;
    this.heatmapAcc = Infinity;
    if (!enabled && !this.durabilityHeatmap) this.restoreColors();
  }

  /** 디버그: 조각 색을 남은 내구도로 */
  setDurabilityHeatmap(enabled: boolean): void {
    this.durabilityHeatmap = enabled;
    this.heatmapAcc = Infinity;
    if (!enabled && !this.damageHeatmap) this.restoreColors();
  }

  /** 내구도 켬/끔: 끄면 모든 조각이 내구도 0처럼 바로 깨진다 */
  setDurabilityEnabled(enabled: boolean): void {
    this.durabilityEnabled = enabled;
    if (this.system) this.system.durability.enabled = enabled;
  }

  /** 조각별 최대 내구도 (건물 생성 전 빈 배열) */
  maxDurabilityOf(i: number): number {
    return this.system?.durability.max[i] ?? 0;
  }

  /** 지정 지점에 에너지(J)만큼 폭발. 반환: 파괴 반경 (건물이 없으면 0) */
  detonate(point: Vector3, energy: number, random?: () => number): number {
    const radius = this.system?.detonate(point, energy, random) ?? 0;
    if (radius > 0) {
      this.effects.blast(point, radius);
      this.burning?.cannonBlast(point);
    }
    return radius;
  }

  /** 화염 폭발: 넓게 얕게 부수고, 반경 안 유리를 깨고, 불을 붙인다. 반환: 폭발 반경 */
  fireBlast(point: Vector3, random?: () => number): number {
    const radius = this.system?.detonate(point, 0, random, fireballProfile()) ?? 0;
    if (radius <= 0) return 0;
    this.effects.fireBlast(point, radius);
    this.burning?.ignite(point, FIREBALL.blastHeatRadius, FIREBALL.blastHeat);
    return radius;
  }

  /** 디버그: 불을 전부 끈다 */
  extinguish(): void {
    this.burning?.extinguish();
  }

  setSpreadMultiplier(v: number): void {
    this.spreadMultiplier = v;
    if (this.burning) this.burning.system.spreadMultiplier = v;
  }

  /** 디버그: 조각 색을 heat로 */
  setHeatmap(enabled: boolean): void {
    this.heatmap = enabled;
    const f = this.burning;
    if (!f) return;
    f.heatmap = enabled;
    if (!enabled) this.restoreColors();
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
    this.burning?.dispose();
    this.burning = null;
    this.damageView = null;
    this.rebar.clear();
    this.finaleActive = false;
    this.materials.quake.value = 0;
    this.materials.crackFloor.value = 0;
    this.warned = false;
    this.system?.dispose();
    this.system = null;
    this.effects.clear();
    this.effects.setQuality(this.settings.quality);
    // 프리셋이 바뀌면 유리 방식도 프리셋 기본값으로 (GUI로 바꾼 값은 다음 프리셋 변경까지 유지)
    if (this.settings.quality !== this.builtQuality) {
      this.builtQuality = this.settings.quality;
      this.glassMode = GLASS.modeByQuality[this.builtQuality];
      this.applyGlassMode();
    }
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
    this.kinds = frags.map((f) => members[f.member]!.kind);
    const d = new DestructionSystem(
      this.scene,
      this.physics,
      frags,
      this.materials,
      (i) => ({ anchor: member(i).anchor, cladding: CLADDING.includes(member(i).kind) }),
      volumePercentile(frags, DEBRIS.simpleColliderPercentile),
      true, // 손상 반응 (느슨한 조각 낙하, 손상 부위 증폭)
      Durability.initial(
        frags.length,
        (i) => member(i).kind,
        (i) => member(i).anchor,
        params.seed,
        params.durabilityBonus,
      ),
    );
    this.system = d;
    d.durability.enabled = this.durabilityEnabled;
    // 단단한 조각은 처음부터 짙은 콘크리트 톤: 여기는 버티겠다는 게 보이게
    for (let i = 0; i < frags.length; i++) {
      const m = d.durability.max[i]!;
      if (m === 0) continue;
      const tone = Math.max(0.5, 1 - DURABILITY.toneDarkPerPoint * m);
      d.fragments.meshes.setBaseColor(i, tone, tone, tone);
    }
    d.ground = this.ground;
    d.onGroundImpact = (body, speed) =>
      this.effects.groundImpact(body.currPos, speed, body.rigidBody.mass());
    d.onGlassBroken = (position) => this.effects.glassBroken(position);
    this.burning = new BuildingFire(
      d,
      (i) => member(i).kind,
      this.effects.fire,
      this.lights,
      createRng(params.seed + 1),
    );
    this.burning.heatmap = this.heatmap;
    this.burning.system.spreadMultiplier = this.spreadMultiplier;
    this.damageView = new DamageView(d, this.physics, this.materials);
    const view = this.damageView;
    d.onDurabilityHit = (i, _lost, effect) => {
      view.onHit(i);
      if (effect) {
        const p = d.positions;
        this.effects.durabilityHit({ x: p[i * 3]!, y: p[i * 3 + 1]!, z: p[i * 3 + 2]! });
      }
    };
    if (!this.damageEffects) this.damageView.setEnabled(false);
    this.rebarRevision = -1;
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
