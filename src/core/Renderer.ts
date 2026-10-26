// WebGL2 렌더러 생성/리사이즈, 톤매핑·그림자 설정
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import { RENDER } from '../config';

export class Renderer {
  readonly webgl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.webgl = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.webgl.toneMapping = ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = RENDER.exposure;
    this.webgl.outputColorSpace = SRGBColorSpace;
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = PCFShadowMap;

    this.camera = new PerspectiveCamera(RENDER.fov, 1, RENDER.near, RENDER.far);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  render(): void {
    this.webgl.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.webgl.dispose();
  }

  private readonly resize = (): void => {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.webgl.setSize(width, height, false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  };
}
