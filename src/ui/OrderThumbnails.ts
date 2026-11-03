// 주문 카드 건물 미리보기: 분할하지 않은 부재 박스를 작은 오프스크린 렌더 타깃에 그려 이미지로 캐시한다.
// 메인 WebGLRenderer를 잠깐 빌려 쓴다 (게시판이 열릴 때 카드 3장, 같은 주문은 캐시에서).
// 렌더 타깃·인스턴스 버퍼는 그린 직후 해제한다 (박스 지오메트리·재질은 셰이더 재컴파일을 피하려고 계속 쓴다).
// 색은 부재 재질(MATERIALS 외면 색)을 인스턴스 색으로. 볼록 부재(박공·n각 탑)는 다면체를 그대로 그린다 (정점 색).
import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Color,
  DirectionalLight,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { buildArchetype } from '../building/archetypes';
import { isConvexMember, memberPolyhedron, type Member } from '../building/Member';
import { MATERIALS, ORDERS } from '../config';
import type { Order } from '../orders/Order';

const FOV = 30;
/** 3/4 시점 방향 (건물 앞 오른쪽 위) */
const VIEW_DIR = new Vector3(0.85, 0.55, 1).normalize();
const BACKGROUND = 0x2a2d33;
const m = new Matrix4();
const color = new Color();

export class OrderThumbnails {
  /** order.id → data URL (최근 것이 뒤, LRU) */
  private readonly cache = new Map<string, string>();
  private readonly box = new BoxGeometry(1, 1, 1);
  private readonly material = new MeshLambertMaterial({ color: 0xffffff });
  private readonly vertexColored = new MeshLambertMaterial({ vertexColors: true });

  constructor(private readonly renderer: WebGLRenderer) {}

  /** 주문의 미리보기 이미지 (data URL) */
  get(order: Order): string {
    const hit = this.cache.get(order.id);
    if (hit !== undefined) {
      this.cache.delete(order.id);
      this.cache.set(order.id, hit);
      return hit;
    }
    const url = this.render(order);
    this.cache.set(order.id, url);
    while (this.cache.size > ORDERS.thumbnail.cacheSize) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return url;
  }

  private render(order: Order): string {
    const { width, height } = ORDERS.thumbnail;
    const { members, footprint, height: top } = buildArchetype(order.building);
    const scene = new Scene();
    scene.background = new Color(BACKGROUND);
    scene.add(new AmbientLight(0xffffff, 1.2));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(1, 2, 1.5);
    scene.add(sun);
    const meshes = [
      instanced(
        this.box,
        this.material,
        members.filter((x) => !isConvexMember(x)),
      ),
      convexMesh(
        this.vertexColored,
        members.filter((x) => isConvexMember(x)),
      ),
    ];
    for (const mesh of meshes) if (mesh) scene.add(mesh);

    // 건물 전체가 들어오게: 바운딩 구 반지름 / sin(fov/2)
    const center = new Vector3(
      (footprint.min.x + footprint.max.x) / 2,
      top / 2,
      (footprint.min.z + footprint.max.z) / 2,
    );
    const radius =
      0.5 * Math.hypot(footprint.max.x - footprint.min.x, top, footprint.max.z - footprint.min.z);
    const camera = new PerspectiveCamera(FOV, width / height, 0.1, radius * 10);
    const dist = radius / Math.sin(((FOV / 2) * Math.PI) / 180);
    camera.position.copy(center).addScaledVector(VIEW_DIR, dist);
    camera.lookAt(center);

    const target = new WebGLRenderTarget(width, height);
    target.texture.colorSpace = SRGBColorSpace;
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const shadows = r.shadowMap.enabled;
    r.shadowMap.enabled = false;
    r.setRenderTarget(target);
    r.clear(); // 후처리(postprocessing)가 autoClear를 끈다
    r.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    r.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    r.setRenderTarget(previous);
    r.shadowMap.enabled = shadows;

    target.dispose();
    for (const mesh of meshes) {
      if (mesh instanceof InstancedMesh) mesh.dispose();
      else mesh?.geometry.dispose();
    }
    return toDataUrl(pixels, width, height);
  }
}

function instanced(
  geometry: BoxGeometry,
  material: MeshLambertMaterial,
  members: readonly Member[],
): InstancedMesh | null {
  if (members.length === 0) return null;
  const mesh = new InstancedMesh(geometry, material, members.length);
  members.forEach(({ box: b, material }, i) => {
    m.makeScale(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    m.setPosition((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(MATERIALS[material].exterior.color));
  });
  return mesh;
}

/** 볼록 부재들을 한 메시로 (면마다 부채꼴 삼각형, 면 법선, 재질 색) */
function convexMesh(material: MeshLambertMaterial, members: readonly Member[]): Mesh | null {
  if (members.length === 0) return null;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const member of members) {
    color.setHex(MATERIALS[member.material].exterior.color);
    for (const f of memberPolyhedron(member).faces) {
      const v = f.verts;
      for (let k = 3; k + 5 < v.length; k += 3) {
        for (const o of [0, k, k + 3]) {
          pos.push(v[o]!, v[o + 1]!, v[o + 2]!);
          nor.push(f.nx, f.ny, f.nz);
          col.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return new Mesh(g, material);
}

/** WebGL 픽셀(아래→위)을 위→아래로 뒤집어 PNG data URL로 */
function toDataUrl(pixels: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const image = ctx.createImageData(width, height);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
