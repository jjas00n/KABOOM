// 건물 디버그 샌드박스 (?sandbox=building): 궤도 카메라 + 클릭 폭발 + 재현 시나리오.
// 건물 생성·파괴 자체는 BuildingSite가 한다.
import { Raycaster, Vector2, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BUILDING, BUILDING_DEMO } from '../config';
import type { Assets } from '../core/Assets';
import type { Renderer } from '../core/Renderer';
import { createRng } from '../fracture/seeds';
import { BuildingSite } from '../game/BuildingSite';
import type { TimeControl } from '../game/Game';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { LoadingOverlay } from '../ui/LoadingOverlay';
import { createOrbitControls, onCanvasClick, Stage } from './Stage';

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

export class BuildingDemo {
  readonly site: BuildingSite;
  readonly stage: Stage;
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly position = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    physics: PhysicsWorld,
    loading: LoadingOverlay,
    assets: Assets | null = null,
    time: TimeControl | null = null,
  ) {
    this.stage = new Stage(renderer, physics, assets);
    this.controls = createOrbitControls(
      renderer,
      BUILDING_DEMO.cameraPosition,
      BUILDING_DEMO.cameraTarget,
    );
    this.site = new BuildingSite(renderer.scene, physics, loading, assets, this.stage.ground, time);
    onCanvasClick(renderer.canvas, (x, y) => {
      this.pointer.set(x, y);
      this.explodeAtPointer();
    });
    this.reset();
  }

  /** 고정 timestep마다 (물리 스텝 직후) */
  step(dt: number): void {
    this.site.step(dt);
  }

  update(dt: number): void {
    this.controls.update();
    this.site.update(dt);
    this.stage.update(dt, this.site.bounds);
  }

  reset(): void {
    void this.site.reset();
  }

  /**
   * 성능 측정용 재현 시나리오: 모든 층의 주어진 외벽들(기본: -z면, +x면) 칸 중앙을 한꺼번에 폭파.
   * 같은 건물 설정이면 매번 같은 결과.
   */
  smashTest(facades: readonly Facade[] = [MINUS_Z, PLUS_X]): void {
    if (!this.site.destruction || !this.site.footprint) return;
    const { floors, floorHeight } = this.site.settings;
    const random = createRng(BUILDING_DEMO.smashSeed);
    for (let f = 0; f < floors; f++) {
      const y = BUILDING.foundationThickness + (f + 0.5) * floorHeight;
      for (const facade of facades) {
        const bays = this.baysAlong(facade);
        for (let i = 0; i < bays; i++) {
          this.pointOnFacade(facade, (i + 0.5) / bays, 0, y, this.position);
          this.site.detonate(this.position, BUILDING_DEMO.smashEnergy, random);
        }
      }
    }
  }

  /** 붕괴 확인 시나리오: 주어진 외벽(기본: -z면)의 1층 기둥 줄을 작은 폭발로 하나씩 날린다 */
  pullColumns(facade: Facade = MINUS_Z): void {
    if (!this.site.destruction || !this.site.footprint) return;
    const half = BUILDING.columnSize / 2;
    const y = BUILDING.foundationThickness + this.site.settings.floorHeight * 0.4;
    const bays = this.baysAlong(facade);
    for (let i = 0; i <= bays; i++) {
      // 기둥 중심: 양 끝은 외곽에서 half 안쪽, 사이는 같은 간격
      this.pointOnFacade(facade, i / bays, half, y, this.position);
      this.site.detonate(this.position, BUILDING_DEMO.columnEnergy);
    }
  }

  /** 카메라가 보고 있는 외벽들 (카메라 쪽을 향한 면, 정면에 가까운 순) */
  viewedFacades(): Facade[] {
    const footprint = this.site.footprint;
    if (!footprint) return [];
    const { min, max } = footprint;
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
    return facade.axis === 'z' ? this.site.settings.baysX : this.site.settings.baysZ;
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
    const { min, max } = this.site.footprint!;
    const [a, b] = facade.axis === 'z' ? [min.x, max.x] : [min.z, max.z];
    const along = a + inset + t * (b - a - 2 * inset);
    const face =
      facade.axis === 'z' ? (facade.sign > 0 ? max.z : min.z) : facade.sign > 0 ? max.x : min.x;
    const plane = face - facade.sign * inset;
    return facade.axis === 'z' ? out.set(along, y, plane) : out.set(plane, y, along);
  }

  private explodeAtPointer(): void {
    const d = this.site.destruction;
    if (!d) return;
    this.raycaster.setFromCamera(this.pointer, this.renderer.camera);
    const hit = d.fragments.raycast(this.raycaster);
    if (!hit) return;
    this.site.detonate(this.position.copy(hit.point), BUILDING_DEMO.clickEnergy);
  }
}
