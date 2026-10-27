// 공용 무대: HDRI 하늘·환경광, 태양(동적 그림자 범위), 지면(시각 + 물리). 디버그용 OrbitControls 생성 헬퍼.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LIGHTING, RENDER, SANDBOX, TEXTURES } from '../config';
import type { Assets } from '../core/Assets';
import type { Renderer } from '../core/Renderer';
import { ShadowFit } from '../fx/ShadowFit';
import { XRAY_HIDE } from '../fx/XRayView';
import type { Aabb, Vec3Like } from '../fracture/polyhedron';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

export class Stage {
  readonly sun: DirectionalLight;
  readonly ground: PhysicsBody;
  readonly shadows: ShadowFit;

  constructor(
    renderer: Renderer,
    private readonly physics: PhysicsWorld,
    assets: Assets | null,
  ) {
    const { scene } = renderer;
    if (assets) {
      scene.background = assets.sky;
      scene.backgroundBlurriness = LIGHTING.backgroundBlurriness;
      scene.backgroundIntensity = LIGHTING.backgroundIntensity;
      scene.environment = assets.environment;
      scene.environmentIntensity = LIGHTING.environmentIntensity;
      scene.fog = new FogExp2(LIGHTING.fogColor, LIGHTING.fogDensity);
    } else {
      scene.background = new Color(LIGHTING.background);
    }

    this.sun = new DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.normalBias = RENDER.shadowNormalBias;
    scene.add(this.sun, this.sun.target);
    this.shadows = new ShadowFit(this.sun, LIGHTING.sunDirection);
    scene.add(
      assets
        ? new HemisphereLight(
            LIGHTING.bounceSkyColor,
            LIGHTING.bounceGroundColor,
            LIGHTING.bounceIntensity,
          )
        : new HemisphereLight(
            LIGHTING.hemiSkyColor,
            LIGHTING.hemiGroundColor,
            LIGHTING.hemiIntensity,
          ),
    );

    // 보이는 지면은 물리 지면보다 훨씬 크게: 끝이 안개에 묻혀 지평선이 된다 (HDRI 하늘은 아래가 비어 있다)
    const size = assets ? TEXTURES.groundVisualSize : SANDBOX.groundSize;
    const material = new MeshStandardMaterial({ color: SANDBOX.groundColor, roughness: 1 });
    if (assets) {
      const repeat = size * TEXTURES.groundScale;
      const tiled = (t: Texture) => {
        const c = t.clone();
        c.repeat.set(repeat, repeat);
        return c;
      };
      const g = assets.ground;
      material.color.set(TEXTURES.groundTint);
      material.map = tiled(g.color);
      material.normalMap = tiled(g.normal);
      material.roughnessMap = tiled(g.roughness);
      if (g.ao) material.aoMap = tiled(g.ao);
    }
    const ground = new Mesh(new PlaneGeometry(size, size), material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData[XRAY_HIDE] = true;
    scene.add(ground);

    const half = SANDBOX.groundThickness / 2;
    const physicsHalf = SANDBOX.groundSize / 2;
    this.ground = physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -half, 0),
      RAPIER.ColliderDesc.cuboid(physicsHalf, half, physicsHalf).setActiveEvents(
        RAPIER.ActiveEvents.COLLISION_EVENTS,
      ),
    );
  }

  /**
   * 렌더 프레임마다: 그림자 범위를 focus(건물 등)와 움직이는 바디들에 맞춘다.
   * focus가 없고 움직이는 것도 없으면 범위를 그대로 둔다.
   */
  update(dt: number, focus: Aabb | null): void {
    const { shadows } = this;
    shadows.begin();
    if (focus) shadows.includeBox(focus);
    this.physics.forEachMoving((body) => {
      if (body.awake) shadows.includePoint(body.currPos);
    });
    shadows.update(dt);
  }
}

/** 카메라를 cameraPosition에 두고 cameraTarget을 도는 궤도 컨트롤 (샌드박스용) */
export function createOrbitControls(
  renderer: Renderer,
  cameraPosition: Vec3Like,
  cameraTarget: Vec3Like,
): OrbitControls {
  const { camera, canvas } = renderer;
  camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(cameraTarget.x, cameraTarget.y, cameraTarget.z);
  controls.enableDamping = true;
  controls.update();
  return controls;
}

/** 클릭(드래그 아님)만 골라 정규화 좌표(NDC)로 넘겨준다. 해제 함수를 반환. */
export function onCanvasClick(
  canvas: HTMLCanvasElement,
  handler: (ndcX: number, ndcY: number) => void,
): () => void {
  let downX = 0;
  let downY = 0;
  const down = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const up = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > SANDBOX.clickDragThresholdPx) return; // 카메라 드래그였음
    const rect = canvas.getBoundingClientRect();
    handler(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointerup', up);
  };
}
