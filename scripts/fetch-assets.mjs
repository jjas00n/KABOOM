// CC0 텍스처/HDRI를 받아 public/textures/ 에 풀어 둔다. 한 번 실행하고 결과 파일을 커밋한다
// (런타임에는 외부 CDN에 의존하지 않는다). 출처는 public/textures/CREDITS.md.
//   node scripts/fetch-assets.mjs
// 압축 해제: Windows는 시스템 bsdtar (Git Bash의 GNU tar는 zip을 못 읽는다), 그 밖은 unzip.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, '../public/textures');

/** 폴더 이름 → ambientCG 재질. ao: AO 맵도 저장 (UV가 있는 표면만 쓴다. 단면은 트라이플래너라 안 씀) */
const MATERIALS = {
  'concrete-exterior': { id: 'Concrete042A', ao: true },
  'concrete-interior': { id: 'Concrete025', ao: false },
  ground: { id: 'Ground091', ao: true },
};
/** 맵 이름 접미사 → 저장 파일 이름 */
const MAPS = {
  Color: 'color.jpg',
  NormalGL: 'normal.jpg',
  Roughness: 'roughness.jpg',
  AmbientOcclusion: 'ao.jpg',
};
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function unzip(zip, dir) {
  if (process.platform === 'win32') {
    const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', dir]);
  } else {
    execFileSync('unzip', ['-q', zip, '-d', dir]);
  }
}

async function fetchMaterial(folder, { id: assetId, ao }) {
  const tmp = mkdtempSync(join(tmpdir(), 'kaboom-'));
  try {
    const zip = join(tmp, `${assetId}.zip`);
    writeFileSync(zip, await download(`https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`));
    const extracted = join(tmp, 'x');
    mkdirSync(extracted);
    unzip(zip, extracted);
    const dir = join(OUT, folder);
    mkdirSync(dir, { recursive: true });
    for (const file of readdirSync(extracted)) {
      for (const [suffix, name] of Object.entries(MAPS)) {
        if (suffix === 'AmbientOcclusion' && !ao) continue;
        if (file.endsWith(`_${suffix}.jpg`)) copyFileSync(join(extracted, file), join(dir, name));
      }
    }
    console.log(`${folder} ← ${assetId}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

for (const [folder, material] of Object.entries(MATERIALS)) await fetchMaterial(folder, material);
writeFileSync(
  join(OUT, 'sky.hdr'),
  await download(`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${HDRI}_1k.hdr`),
);
console.log(`sky.hdr ← ${HDRI}`);
