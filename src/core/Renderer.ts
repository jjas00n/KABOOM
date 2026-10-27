// WebGL2 렌더러 생성/리사이즈, 톤매핑·그림자 설정. 화면 출력은 후처리 체인(PostFX)을 거친다.
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { RENDER } from '../config';
import { PostFX } from '../fx/PostFX';

export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly postfx: PostFX;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.webgl = new WebGLRenderer({
      canvas,
      antialias: false, // SMAA(후처리)가 대신한다. 멀티샘플 버퍼는 후처리 버퍼로 가지 않아 낭비
      powerPreference: 'high-performance',
      stencil: false,
    });
    // 톤매핑 방식은 후처리를 끈 경우에만 쓰인다 (켜져 있으면 PostFX의 ToneMappingEffect). 노출은 둘 다 쓴다
    this.webgl.toneMapping = ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = RENDER.exposure;
    this.webgl.outputColorSpace = SRGBColorSpace;
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = PCFShadowMap;

    this.camera = new PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);
    this.postfx = new PostFX(this.webgl, this.scene, this.camera);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** dt: 실제 경과 시간 (후처리 펄스 감쇠) */
  render(dt: number): void {
    this.postfx.render(dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.postfx.dispose();
    this.webgl.dispose();
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.webgl.setSize(width, height, false);
    this.postfx.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  };
}
