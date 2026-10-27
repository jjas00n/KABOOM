// 디버그 GUI: 후처리 토글 + 유리 렌더 방식 (게임과 건물 샌드박스가 같이 쓴다)
import type GUI from 'lil-gui';
import type { PostFX } from '../fx/PostFX';
import type { BuildingSite } from '../game/BuildingSite';

export function addVisualsGui(gui: GUI, postfx: PostFX, site: BuildingSite): GUI {
  const folder = gui.addFolder('Visuals');
  const s = postfx.settings;
  const apply = () => postfx.apply();
  folder.add(s, 'enabled').name('Post FX').onChange(apply);
  folder.add(s, 'ao').name('SSAO (N8AO)').onChange(apply);
  folder.add(s, 'smaa').name('SMAA').onChange(apply);
  folder.add(s, 'bloom').name('Bloom').onChange(apply);
  folder.add(s, 'vignette').name('Vignette').onChange(apply);
  folder.add(s, 'impactPulse').name('Impact blur').onChange(apply);
  folder.add({ pulse: () => postfx.pulse() }, 'pulse').name('Test pulse');
  folder
    .add(site, 'glassMode', ['reflective', 'transmission'])
    .name('Glass')
    .onChange(() => site.applyGlassMode())
    .listen();
  return folder;
}
