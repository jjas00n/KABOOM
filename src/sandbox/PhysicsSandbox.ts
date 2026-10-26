// Phase 1 임시 샌드박스: 박스 200개 + 클릭 발사. 건물/대포가 들어오면 제거한다.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEBRIS, LIGHTING, RENDER, SANDBOX } from '../config';
import type { Renderer } from '../core/Renderer';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const IDENTITY_ROT = { x: 0, y: 0, z: 0, w: 1 };
const ZERO = { x: 0, y: 0, z: 0 };

export class PhysicsSandbox {
  private readonly controls: OrbitControls;
  private readonly boxes: InstancedMesh;
  private readonly boxBodies: PhysicsBody[] = [];
  private readonly boxHome: Vector3[] = [];
  private readonly spheres: InstancedMesh;
  private readonly sphereSlots: (PhysicsBody | null)[] = [];
  private nextSphere = 0;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly pointerDown = new Vector2();
  private readonly fireDir = new Vector3();
  private readonly firePos = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly physics: PhysicsWorld,
  ) {
    const { scene, camera, canvas } = renderer;
    scene.background = new Color(LIGHTING.background);

    this.addLights();
    this.addGround();

    const { x: nx, y: ny, z: nz } = SANDBOX.boxGrid;
    const size = SANDBOX.boxSize;
    this.boxes = new InstancedMesh(
      new BoxGeometry(size, size, size),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
      nx * ny * nz,
    );
    this.boxes.castShadow = true;
    this.boxes.receiveShadow = true;
    this.boxes.frustumCulled = false; // 인스턴스가 움직이므로 바운딩 구가 금방 틀어진다
    scene.add(this.boxes);
    this.addBoxes(nx, ny, nz, size);

    this.spheres = new InstancedMesh(
      new SphereGeometry(SANDBOX.sphereRadius, 24, 16),
      new MeshStandardMaterial({ color: SANDBOX.sphereColor, roughness: 0.4, metalness: 0.6 }),
      SANDBOX.maxSpheres,
    );
    this.spheres.castShadow = true;
    this.spheres.frustumCulled = false;
    for (let i = 0; i < SANDBOX.maxSpheres; i++) {
      this.spheres.setMatrixAt(i, HIDDEN);
      this.sphereSlots.push(null);
    }
    scene.add(this.spheres);

    const { cameraPosition: cp, cameraTarget: ct } = SANDBOX;
    camera.position.set(cp.x, cp.y, cp.z);
    this.controls = new OrbitControls(camera, canvas);
    this.controls.target.set(ct.x, ct.y, ct.z);
    this.controls.enableDamping = true;
    this.controls.update();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
  }

  update(): void {
    this.controls.update();
    this.physics.removeBelow(DEBRIS.killY, this.onBodyRemoved);
  }

  resetBoxes(): void {
    for (let i = 0; i < this.boxBodies.length; i++) {
      const body = this.boxBodies[i]!;
      if (!this.physics.has(body)) {
        // 지면 밖으로 떨어져 제거된 박스는 새로 만든다
        this.boxBodies[i] = this.createBox(i);
        continue;
      }
      const rb = body.rigidBody;
      rb.setTranslation(this.boxHome[i]!, false);
      rb.setRotation(IDENTITY_ROT, false);
      rb.setLinvel(ZERO, false);
      rb.setAngvel(ZERO, false);
      rb.wakeUp();
      body.snap();
    }
    for (let i = 0; i < this.sphereSlots.length; i++) {
      this.removeSphere(i);
    }
    this.spheres.instanceMatrix.needsUpdate = true;
  }

  private addLights(): void {
    const sun = new DirectionalLight(LIGHTING.sunColor, LIGHTING.sunIntensity);
    const sp = LIGHTING.sunPosition;
    sun.position.set(sp.x, sp.y, sp.z);
    sun.castShadow = true;
    sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    const s = RENDER.shadowCameraSize;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    sun.shadow.camera.updateProjectionMatrix();
    this.renderer.scene.add(sun);

    this.renderer.scene.add(
      new HemisphereLight(LIGHTING.hemiSkyColor, LIGHTING.hemiGroundColor, LIGHTING.hemiIntensity),
    );
  }

  private addGround(): void {
    const size = SANDBOX.groundSize;
    const ground = new Mesh(
      new PlaneGeometry(size, size),
      new MeshStandardMaterial({ color: SANDBOX.groundColor, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.renderer.scene.add(ground);

    const half = SANDBOX.groundThickness / 2;
    this.physics.add(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -half, 0),
      RAPIER.ColliderDesc.cuboid(size / 2, half, size / 2),
    );
  }

  private addBoxes(nx: number, ny: number, nz: number, size: number): void {
    const pitch = size + SANDBOX.boxGap;
    const half = size / 2;
    const color = new Color();
    const base = new Color(SANDBOX.boxColor);
    let index = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          this.boxHome.push(
            new Vector3(
              (ix - (nx - 1) / 2) * pitch,
              half + iy * pitch,
              (iz - (nz - 1) / 2) * pitch,
            ),
          );
          this.boxBodies.push(this.createBox(index));
          const shade = 1 + (Math.random() * 2 - 1) * SANDBOX.boxColorJitter;
          this.boxes.setColorAt(index, color.copy(base).multiplyScalar(shade));
          index++;
        }
      }
    }
  }

  private createBox(index: number): PhysicsBody {
    const home = this.boxHome[index]!;
    const half = SANDBOX.boxSize / 2;
    return this.physics.add(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(home.x, home.y, home.z),
      RAPIER.ColliderDesc.cuboid(half, half, half),
      { mesh: this.boxes, index },
    );
  }

  private fireSphere(): void {
    const camera = this.renderer.camera;
    this.raycaster.setFromCamera(this.pointer, camera);
    this.fireDir.copy(this.raycaster.ray.direction);
    this.firePos.copy(camera.position).addScaledVector(this.fireDir, SANDBOX.sphereSpawnOffset);

    const slot = this.nextSphere;
    this.nextSphere = (this.nextSphere + 1) % SANDBOX.maxSpheres;
    this.removeSphere(slot);

    const v = this.fireDir.multiplyScalar(SANDBOX.sphereSpeed);
    this.sphereSlots[slot] = this.physics.add(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.firePos.x, this.firePos.y, this.firePos.z)
        .setLinvel(v.x, v.y, v.z)
        .setCcdEnabled(true),
      RAPIER.ColliderDesc.ball(SANDBOX.sphereRadius)
        .setDensity(SANDBOX.sphereDensity)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      { mesh: this.spheres, index: slot },
    );
  }

  private removeSphere(slot: number): void {
    const body = this.sphereSlots[slot];
    if (!body) return;
    this.physics.remove(body);
    this.hideSphere(slot);
  }

  private hideSphere(slot: number): void {
    this.sphereSlots[slot] = null;
    this.spheres.setMatrixAt(slot, HIDDEN);
    this.spheres.instanceMatrix.needsUpdate = true;
  }

  private readonly onBodyRemoved = (body: PhysicsBody): void => {
    const target = body.target;
    if (!target || !('mesh' in target)) return;
    if (target.mesh === this.spheres) {
      this.hideSphere(target.index);
    } else {
      target.mesh.setMatrixAt(target.index, HIDDEN);
      target.mesh.instanceMatrix.needsUpdate = true;
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDown.set(e.clientX, e.clientY);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    if (Math.hypot(dx, dy) > SANDBOX.clickDragThresholdPx) return; // 카메라 드래그였음

    const rect = this.renderer.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.fireSphere();
  };
}
