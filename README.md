# KABOOM

3D 건물을 대포로 쏴서 산산조각 나는 걸 구경하는 웹 시뮬레이터/게임.

- 기술 스택: Vite + TypeScript, three.js, Rapier(WASM), postprocessing, lil-gui, vitest
- 배포: https://jjas00n.github.io/KABOOM/

## 요구사항

- Node.js 20 이상 (권장: 22 LTS 이상)

## 실행 방법

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (http://localhost:5173/KABOOM/)
npm run build      # 타입체크 + 프로덕션 빌드 → dist/
npm run preview    # 빌드 결과 로컬 미리보기
```

## 조작법

| 상태        | 조작                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| 대기 / 관람 | 드래그: 둘러보기 · **Cannon** 버튼 또는 `C`: 대포 · **Reset** 또는 `R`: 건물 재생성 |
| 관람        | **Back** 또는 `Esc`: 부서진 건물 그대로 처음 화면으로                               |
| 컷신        | 클릭 / `Space`: 건너뛰기                                                            |
| 조준        | 드래그 / `WASD`·방향키: 조준 · 휠 / `Q` `E`: 파워 · 클릭 / `Space`: 발사            |

디버그 샌드박스 (개발 모드에서는 오른쪽 위 디버그 패널도 뜬다):

- `?sandbox=building` — 건물 + 클릭 폭발 + 재현 시나리오(Smash test, Pull columns)
- `?sandbox=fracture` — 박스 하나 보로노이 분할
- `?sandbox=physics` — 물리 샌드박스(박스 200개)

## 테스트 / 코드 품질

```bash
npm test           # vitest 단위 테스트 1회 실행
npm run test:watch # 감시 모드
npm run lint       # ESLint
npm run format     # Prettier로 전체 포맷
```

## 디렉터리 구조

```
src/
  main.ts       진입점
  config.ts     튜닝 상수 (매직 넘버는 여기에)
  core/         렌더러, 게임 루프, 에셋
  physics/      Rapier 래퍼, 충돌 이벤트
  fracture/     3D 보로노이 사전 분할 (Web Worker)
  building/     절차적 건물 생성, 구조 그래프
  destruction/  폭발, 붕괴 판정, 파편 관리
  game/         상태 머신, 대포, 포탄
  camera/       컷신/조준/추적/관람 카메라
  fx/           먼지, 파편 파티클, 포스트프로세싱
  ui/           HUD, 디버그 GUI
  audio/        효과음
tests/          vitest 단위 테스트
public/         정적 에셋 (텍스처 출처: public/textures/CREDITS.md)
```

## 배포

`main` 브랜치에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가 lint → test → build 후 GitHub Pages에 배포한다.

최초 1회: 레포 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 설정해야 한다.
