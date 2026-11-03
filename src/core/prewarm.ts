// 시작할 때 한 번: 씬에 있는 모든 것(숨겨 둔 마법사·발사체·궤적선 등 포함)을 보이지 않는 1×1 렌더 타깃에
// 그려 지오메트리·텍스처를 GPU에 올리고 셰이더를 컴파일해 둔다.
// 안 하면 처음 쓰는 순간(첫 발사, 마법사 첫 등장)에 업로드·컴파일로 프레임이 튀고,
// renderer.info 자원 수도 첫 주문 동안 늘어나 메모리 soak 비교가 흐려진다.
import {
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';

export function prewarmGpu(webgl: WebGLRenderer, scene: Scene, camera: Camera): void {
  const saved: { object: Object3D; visible: boolean; culled: boolean }[] = [];
  scene.traverse((object) => {
    saved.push({ object, visible: object.visible, culled: object.frustumCulled });
    object.visible = true;
    object.frustumCulled = false;
  });
  const target = new WebGLRenderTarget(1, 1);
  const previous = webgl.getRenderTarget();
  webgl.setRenderTarget(target);
  webgl.render(scene, camera);
  webgl.setRenderTarget(previous);
  target.dispose();
  for (const s of saved) {
    s.object.visible = s.visible;
    s.object.frustumCulled = s.culled;
  }
}
