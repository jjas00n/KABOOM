// Phase 1 임시 샌드박스: 박스 200개 + 클릭 발사. 건물/대포가 들어오면 제거한다.
import RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEBRIS, SANDBOX } from '../config';
import type { Renderer } from '../core/Renderer';
import type { PhysicsBody, PhysicsWorld } from '../physics/PhysicsWorld';
import { createStage, onCanvasClick } from './Stage';

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
  private readonly fireDir = new Vector3();
  private readonly firePos = new Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly physics: PhysicsWorld,
  ) {
    const { scene, canvas } = renderer;
    this.controls = createStage(renderer, physics, SANDBOX.cameraPosition, SANDBOX.cameraTarget);

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

    onCanvasClick(canvas, (x, y) => {
      this.pointer.set(x, y);
      this.fireSphere();
    });
  }

  update(): void {
    this.controls.update();
    this.physics.removeBelow(DEBRIS.killY, this.onBodyRemoved);
  }

  reset(): void {
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
}
