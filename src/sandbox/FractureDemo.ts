// Phase 2 분할 데모: 콘크리트 박스 1개를 보로노이로 사전 분할 → 처음엔 fixed, 클릭하면 폭발로 흩어진다.
// ?sandbox=fracture 로 연다. 분할 엔진 확인용.
import { Raycaster, Vector2, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEBRIS, FRACTURE_DEMO } from '../config';
import type { Renderer } from '../core/Renderer';
import { applyExplosion } from '../destruction/Explosion';
import { FragmentSet, hideRemovedFragment } from '../destruction/FragmentSet';
import { fractureInWorker } from '../fracture/FractureJob';
import { createFragmentMaterials } from '../fracture/FragmentMeshes';
import { adaptiveSeeds, createRng, jitteredGridSeeds, uniformSeeds } from '../fracture/seeds';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
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
  private readonly materials = createFragmentMaterials();
  private fragments: FragmentSet | null = null;
  private shattered = false;
  /** reset이 겹쳐 들어오면 늦게 끝난 이전 분할 결과를 버리기 위한 세대 번호 */
  private generation = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
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
    this.physics.removeBelow(DEBRIS.killY, hideRemovedFragment);
  }

  /** 현재 설정으로 박스를 다시 분할해 새로 세운다 */
  reset(): void {
    const generation = ++this.generation;
    this.fragments?.dispose();
    this.fragments = null;
    this.shattered = false;
    const started = performance.now();
    fractureInWorker({ jobs: [{ box: BOX, seeds: this.makeSeeds() }] })
      .then((frags) => {
        if (generation !== this.generation) return;
        this.lastFractureMs = Math.round(performance.now() - started);
        this.fragments = new FragmentSet(this.renderer.scene, this.physics, frags, this.materials);
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

  private explodeAtPointer(): void {
    if (!this.fragments) return;
    this.raycaster.setFromCamera(this.pointer, this.renderer.camera);
    const hit = this.fragments.raycast(this.raycaster);
    if (!hit) return;

    if (!this.shattered) {
      this.shattered = true;
      this.fragments.activateAll();
    }
    applyExplosion(this.fragments.bodies, this.position.copy(hit.point), {
      radius: FRACTURE_DEMO.explosionRadius,
    });
  }
}
