// 텍스처/HDRI 로딩 (public/textures, 출처 CREDITS.md). 게임 시작 전에 한 번 다 받아 둔다.
import {
  EquirectangularReflectionMapping,
  LoadingManager,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { TEXTURES } from '../config';

/** PBR 맵 한 벌. ao는 있는 재질만 */
export interface PbrTextures {
  color: Texture;
  normal: Texture;
  roughness: Texture;
  ao?: Texture;
}

export interface Assets {
  exterior: PbrTextures;
  interior: PbrTextures;
  ground: PbrTextures;
  /** 배경용 HDR (equirect) */
  sky: Texture;
  /** 조명/반사용 PMREM 환경맵 */
  environment: Texture;
}

/** onProgress: 0 ~ 1 */
export async function loadAssets(
  renderer: WebGLRenderer,
  onProgress?: (fraction: number) => void,
): Promise<Assets> {
  const manager = new LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress?.(loaded / total);
  const textures = new TextureLoader(manager);
  const base = `${import.meta.env.BASE_URL}${TEXTURES.dir}`;
  const anisotropy = Math.min(TEXTURES.anisotropy, renderer.capabilities.getMaxAnisotropy());

  const load = async (path: string, srgb: boolean): Promise<Texture> => {
    const t = await textures.loadAsync(`${base}${path}`);
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const pbr = async (folder: string, withAo: boolean): Promise<PbrTextures> => {
    const [color, normal, roughness, ao] = await Promise.all([
      load(`${folder}/color.jpg`, true),
      load(`${folder}/normal.jpg`, false),
      load(`${folder}/roughness.jpg`, false),
      withAo ? load(`${folder}/ao.jpg`, false) : undefined,
    ]);
    return { color, normal, roughness, ao };
  };

  const [exterior, interior, ground, sky] = await Promise.all([
    pbr(TEXTURES.exterior, true),
    pbr(TEXTURES.interior, false),
    pbr(TEXTURES.ground, true),
    new HDRLoader(manager).loadAsync(`${base}${TEXTURES.sky}`),
  ]);
  sky.mapping = EquirectangularReflectionMapping;

  const pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(sky).texture;
  pmrem.dispose();
  return { exterior, interior, ground, sky, environment };
}
