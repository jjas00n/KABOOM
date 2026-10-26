// 공용 무대: 배경, 방향광 + 환경광, 지면(시각 + 물리). 디버그용 OrbitControls 생성 헬퍼.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LIGHTING, RENDER, SANDBOX } from '../config';
import type { Renderer } from '../core/Renderer';
import { XRAY_HIDE } from '../fx/XRayView';
import type { Vec3Like } from '../fracture/polyhedron';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export function createStage(renderer: Renderer, physics: PhysicsWorld): void {
  const { scene } = renderer;
  scene.background = new Color(LIGHTING.background);

  const sun = new DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
  const sp = LIGHTING.sunPosition;
  sun.position.set(sp.x, sp.y, sp.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
  sun.shadow.normalBias = RENDER.shadowNormalBias;
  const s = RENDER.shadowCameraSize;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(
    new HemisphereLight(LIGHTING.hemiSkyColor, LIGHTING.hemiGroundColor, LIGHTING.hemiIntensity),
  );

  const size = SANDBOX.groundSize;
  const ground = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: SANDBOX.groundColor, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData[XRAY_HIDE] = true;
  scene.add(ground);

  const half = SANDBOX.groundThickness / 2;
  physics.add(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -half, 0),
    RAPIER.ColliderDesc.cuboid(size / 2, half, size / 2),
  );
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
