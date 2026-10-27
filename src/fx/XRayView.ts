// 엑스레이 투시 화면: 건물 전체를 반투명 '유령'으로, 구조에서 떨어져 나간(맞은) 조각만 진하게 칠한다.
// BatchedMesh 인스턴스 색에 알파를 넣어(setColorAt + Vector4) 드로우콜을 늘리지 않는다.
// 끄면 재질 설정·배경·인스턴스 색을 원래대로 되돌린다.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  Vector4,
  type Material,
  type Object3D,
  type Scene,
  type Vector3,
} from 'three';
import { XRAY } from '../config';

/** 이 userData 플래그가 붙은 물체(지면, 언덕)는 투시 화면에서 숨긴다 → 배경만 남아 대상이 도드라진다 */
export const XRAY_HIDE = 'xrayHide';
/** 투시 화면이 켜져 있는 동안 scene.userData에 true (스스로 visible을 켜고 끄는 이펙트가 확인한다) */
export const XRAY_ACTIVE = 'xrayActive';
import type { DestructionSystem } from '../destruction/DestructionSystem';
import { MATERIAL } from '../fracture/Fragment';
import type { FragmentMaterials } from '../fracture/FragmentMeshes';

interface SavedMaterial {
  material: Material;
  transparent: boolean;
  depthWrite: boolean;
}

const ghost = new Vector4();
const glass = new Vector4();
const hot = new Vector4();

export class XRayView {
  private active = false;
  private destruction: DestructionSystem | null = null;
  private saved: SavedMaterial[] = [];
  private savedBackground: Scene['background'] = null;
  private hidden: Object3D[] = [];
  private readonly trail: Line;
  private readonly trailPositions = new Float32Array(6);

  constructor(private readonly scene: Scene) {
    const c = new Color(XRAY.ghostColor);
    ghost.set(c.r, c.g, c.b, XRAY.ghostAlpha);
    glass.set(c.r, c.g, c.b, XRAY.glassAlpha);
    const h = new Color(XRAY.hotColor);
    hot.set(h.r, h.g, h.b, XRAY.hotAlpha);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.trailPositions, 3));
    this.trail = new Line(
      geo,
      new LineBasicMaterial({ color: XRAY.trailColor, depthTest: false, transparent: true }),
    );
    this.trail.renderOrder = 2;
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
  }

  get enabled(): boolean {
    return this.active;
  }

  enable(destruction: DestructionSystem, materials: FragmentMaterials): void {
    if (this.active) return;
    this.active = true;
    this.destruction = destruction;
    this.saved = [materials.exterior, materials.interior, materials.glass].map((m) => {
      const s = { material: m, transparent: m.transparent, depthWrite: m.depthWrite };
      m.transparent = true; // 인스턴스 알파를 쓰려면 투명 재질이어야 한다
      m.depthWrite = false;
      m.needsUpdate = true;
      return s;
    });
    this.savedBackground = this.scene.background;
    this.scene.background = new Color(XRAY.background);
    this.scene.userData[XRAY_ACTIVE] = true;
    this.hidden = [];
    this.scene.traverse((o) => {
      if (o.userData[XRAY_HIDE] && o.visible) this.hidden.push(o);
    });
    for (const o of this.hidden) o.visible = false;
    this.trail.visible = true;
    this.refresh();
  }

  /** 맞은 조각 다시 칠하기 (폭발로 새로 떨어져 나간 조각 반영) */
  refresh(): void {
    const d = this.destruction;
    if (!this.active || !d) return;
    const { meshes, fragments } = d.fragments;
    const attached = d.graph.attached;
    meshes.slots.forEach((slots, i) => {
      const color = !attached[i] ? hot : fragments[i]!.material === MATERIAL.glass ? glass : ghost;
      for (const { batch, id } of slots) batch.setColorAt(id, color);
    });
  }

  /** 포탄 궤적: from(충돌 지점) → to(지금 포탄 위치) */
  setTrail(from: Vector3, to: Vector3): void {
    from.toArray(this.trailPositions, 0);
    to.toArray(this.trailPositions, 3);
    this.trail.geometry.getAttribute('position').needsUpdate = true;
  }

  /** 끈다. restoreColors: 조각 색을 원래대로 (디버그 색칠 켜져 있으면 그 색으로) 되돌리는 함수 */
  disable(restoreColors: () => void): void {
    if (!this.active) return;
    this.active = false;
    for (const s of this.saved) {
      s.material.transparent = s.transparent;
      s.material.depthWrite = s.depthWrite;
      s.material.needsUpdate = true;
    }
    this.saved = [];
    this.scene.background = this.savedBackground;
    this.scene.userData[XRAY_ACTIVE] = false;
    for (const o of this.hidden) o.visible = true;
    this.hidden = [];
    this.trail.visible = false;
    restoreColors();
    this.destruction = null;
  }
}
