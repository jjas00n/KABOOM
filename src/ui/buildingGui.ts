// 디버그 GUI: 건물 파라미터 + 구조 통계 폴더 (게임과 건물 샌드박스가 같이 쓴다)
import type GUI from 'lil-gui';
import { BUILDING, QUALITY_PRESETS } from '../config';
import type { BuildingSite } from '../game/BuildingSite';

/** 반환: Building 폴더 (호출 쪽이 버튼을 더 붙일 수 있게) */
export function addBuildingGui(gui: GUI, site: BuildingSite, regenerate: () => void): GUI {
  const { limits } = BUILDING;
  const folder = gui.addFolder('Building');
  const s = site.settings;
  folder.add(s, 'quality', Object.keys(QUALITY_PRESETS)).name('Quality');
  folder.add(s, 'floors', ...limits.floors, 1).name('Floors');
  folder.add(s, 'baysX', ...limits.bays, 1).name('Bays X');
  folder.add(s, 'baysZ', ...limits.bays, 1).name('Bays Z');
  folder.add(s, 'windowRatio', ...limits.windowRatio, 0.05).name('Window ratio');
  folder.add(s, 'seed', 0, 9999, 1).name('Seed');
  folder.add({ regenerate }, 'regenerate').name('Regenerate');
  folder
    .add(site, 'debugColors')
    .name('Color fragments')
    .onChange((v: boolean) => site.setDebugColors(v));
  folder.add(site.stats, 'members').name('Members').disable().listen();
  folder.add(site.stats, 'fragments').name('Fragments').disable().listen();
  folder.add(site.stats, 'loadMs').name('Load ms').disable().listen();

  const structure = gui.addFolder('Structure');
  structure
    .add(site, 'showGraph')
    .name('Show graph')
    .onChange((v: boolean) => site.setShowGraph(v));
  structure.add(site.stats, 'edges').name('Edges').disable().listen();
  const ds = site.destructionStats;
  structure.add(ds, 'overloaded').name('Overloaded edges').disable().listen();
  structure.add(ds, 'islands').name('Islands').disable().listen();
  structure.add(ds, 'compounds').name('Falling chunks').disable().listen();
  structure.add(ds, 'shatters').name('Impact splits').disable().listen();
  structure.add(ds, 'chainBreaks').name('Chain breaks').disable().listen();
  structure.add(ds, 'frozen').name('Frozen debris').disable().listen();
  structure.add(ds, 'fading').name('Fading').disable().listen();
  return folder;
}
