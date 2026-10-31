# KABOOM — 프로젝트 컨텍스트 (Claude Code용)

> 레포: https://github.com/jjas00n/KABOOM
> 이 파일은 레포 루트에 둔다. Claude Code가 매 세션 시작 시 자동으로 읽는다.

## 한 줄 요약
3D 건물을 대포로 쏴서 **산산조각 나는 걸 구경하는** 웹 시뮬레이터/게임.
마리오64 대포처럼 컷신 → 조준 → 발사(발사체 시점) → 충돌 시 건물 시점 복귀 → 붕괴 감상.

## 기술 스택 (확정)
- **Vite + TypeScript (strict)**
- **three** (렌더링) — WebGL2, `BatchedMesh` / `InstancedMesh` 적극 사용
- **@dimforge/rapier3d-compat** (물리, WASM)
- **postprocessing** (SMAA, SSAO/N8AO, Bloom 약하게, Vignette)
- **lil-gui** (디버그 패널, 개발 모드에서만)
- 테스트: **vitest** (지오메트리/분할/그래프 로직 단위 테스트)
- 배포: GitHub Pages (GitHub Actions)

## 그래픽 방향 (확정): 사실적 콘크리트/유리
- PBR 재질: 콘크리트 외벽, 노출된 **단면은 별도 재질**(거칠고 어두운 내부 콘크리트), 유리창은 `MeshPhysicalMaterial`(transmission/roughness).
- 텍스처는 CC0만 사용 (ambientCG / Poly Haven). `public/textures/` 에 1K 해상도로 저장, 출처를 `public/textures/CREDITS.md`에 기록.
- 그림자: 방향광 1개 + CSM 또는 단일 shadow map(2048), HDRI 환경맵(Poly Haven, 1K).
- 이펙트: 먼지 구름(소프트 파티클), 작은 파편(GPU 인스턴싱), 카메라 흔들림, 충돌 순간 짧은 슬로모션(hit-stop).

## 핵심 설계 원칙 — "산산조각"이 최우선
1. **사전 분할(pre-fracture)**: 건물은 처음부터 수천 개의 볼록(convex) 조각으로 생성된다. 실시간 분할은 하지 않는다(성능).
2. **절차적 생성**: 건물은 코드로 만든다(블렌더 X). 층/기둥/슬래브/외벽 패널/창문 → 각 부재를 **3D 보로노이**로 분할.
   - 조각 크기는 부재별로 다르게: 외벽 패널은 잘게(파편감), 기둥·슬래브는 크게(구조감).
   - 충돌 지점 근처를 더 잘게 쪼개는 **적응형 시드 밀도** 옵션을 둔다.
3. **조각 = 볼록 다면체** → Rapier `convexHull` 콜라이더로 1:1 대응.
4. **구조 무결성 그래프**: 조각들을 인접(면 공유) 관계로 연결한 그래프. 지면에 고정된 조각에서 BFS로 도달 불가능한 조각 = 지지 상실 → 동적(dynamic) 전환 → **연쇄 붕괴**.
5. 피격 전 조각은 물리적으로 `fixed`(또는 sleeping) 상태라 비용이 거의 없다. 활성화된 조각만 시뮬레이션.
6. 품질 프리셋 Low/Medium/High (조각 수 대략 1.5k / 4k / 8k). 기본 Medium.

## 게임 흐름 (상태 머신)
```
IDLE ─[대포/마법사 버튼]→ CUTSCENE(launcher) ─(카메라 스플라인 비행 끝)→ AIMING
AIMING ─[발사(마법사는 충전 0.6s 뒤)]→ PROJECTILE_CAM ─(충돌)→ IMPACT(hit-stop ~0.3s) → SPECTATE
SPECTATE ─[대포/마법사 버튼]→ CUTSCENE (부서진·불타는 건물에 재발사 가능)
SPECTATE ─[뒤로]→ IDLE (건물 유지),  SPECTATE ─[리셋]→ IDLE (건물 재생성)
```
- 상태 머신은 `src/game/StateMachine.ts` 한 곳에서만 상태를 바꾼다. 카메라·입력·UI는 상태 변경 이벤트를 구독.
- **발사대(Launcher)**: 대포(`Cannon`)와 파이어볼 마법사(`Wizard`, 건물 기준 대포 반대편 바위 위)가
  `game/Launcher.ts` 인터페이스를 구현한다. `transition(CUTSCENE, launcherId)`로 상태 머신이 선택도 같이 바꾸고
  (`fsm.launcher`), 컷신·조준·체이스 카메라는 발사대가 준 스펙(CutsceneSpec/AimCameraSpec/ChaseSpec)을 쓴다.
- **피해 모델이 다르다**: 대포 = 운동에너지 관통(+엑스레이 킬캠). 파이어볼 = 넓고 얕은 화염 폭발(BlastProfile,
  반경 안 유리 전부 파손) + **화재**(`destruction/FireSystem.ts`): 구조 그래프 위 heat/fuel/burning/charred,
  위로 빠르게·아래로 느리게 확산, 타는 조각의 엣지 용량을 깎아 CollapseSolver가 **지연 붕괴**시킨다.

## 손상 외관과 불변 조건 (논리 상태 = 외관)
- **보이는 조각은 반드시 맞는다**: 잔해 충돌 그룹(발사체 통과)은 움직이는 동안만. 굳으면(fixed) 기본 그룹.
- 불변 조건(`destruction/Invariants.ts`, 테스트 + 디버그 GUI 주기 검사):
  1. 보이는 조각은 콜라이더가 있고, fixed면 발사체와 부딪힌다.
  2. 그래프에서 떨어진 조각은 반드시 dynamic을 거친다.
  3. 렌더↔콜라이더 오차 1cm 이하.
- 조각 damage(0~1, `DamageModel`): 끊긴 연결 면적 + 엣지 누적손상 + 화재 약화.
  - 서 있는 조각은 손상 자세(틈·처짐·기울어짐)로 **fixed 바디째** 순간이동한다 (`PhysicsWorld.teleport`).
  - 균열·열화·흔들림은 배치별 DataTexture → 셰이더. 재질·드로우콜은 늘리지 않는다.
- 너무 약해진 조각은 스텝당 상한까지 떨어뜨린다.
- 손상된 곳을 맞히면 더 넓게 떨어져 나가고, 관통 저항이 낮아 더 깊이 파인다.

## 경제 (Phase 7, 파편 = 돈)
- `src/economy/`는 물리·렌더를 import하지 않는 순수 로직이다. `DestructionSystem.onReleased`(조각이 dynamic으로 전환) 이벤트만 구독한다.
- 조각 가치 = max(질량 × 단가, 최소 가치) × `Modifiers.total` × 희귀 배수.
  - 기초는 단가 0이라 수익도 파괴율도 아니다.
  - 장부(`BuildingLedger`)가 조각마다 한 번만 지급한다.
- 모든 배율은 `Modifiers` 한 곳에서 합성한다: (1 + 가산 합) × 곱셈 배율 곱. Phase 10 업그레이드가 여기에 붙는다.
- 파괴율 = 분리된 질량 / 기초 제외 전체 질량. CollapseSolver 주기에만 갱신한다.
- 수익 출처는 fragments / finale / bonus로 나뉜다 (`Wallet`).
- 컷신 카메라는 `CatmullRomCurve3` + easing. 스킵(클릭/Space) 가능.
- AIMING: 대포 포신 뒤 3인칭 or 포신 안 1인칭, 마우스로 yaw/pitch(제한 각도), 휠/키로 파워, 예상 궤적 점선(선택).
- PROJECTILE_CAM: 발사체 뒤를 따라가는 체이스 캠(약간의 지연/스무딩).
- SPECTATE: 충돌 지점을 바라보는 궤도 카메라(OrbitControls), 처음 몇 초는 자동 연출 카메라.

## 디렉터리 구조 (목표)
```
src/
  main.ts
  core/        Renderer, Loop(고정 timestep 물리 60Hz + 렌더 보간), Assets
  physics/     PhysicsWorld(Rapier 래퍼, teleport), 충돌 이벤트·충돌 그룹, ColliderOverlay(디버그 콜라이더 표시)
  fracture/    voronoi.ts(반공간 클리핑), Fragment.ts, seeds.ts
  building/    BuildingGenerator.ts, members(Column/Slab/WallPanel/Window), StructureGraph.ts
  destruction/ Explosion.ts(임펄스·BlastShape), CollapseSolver.ts(지지 BFS), DebrisManager.ts(정리/수명),
               FireSystem.ts(화재 확산·연소·약화, 순수 로직), DamageModel.ts(조각 손상도·자세·느슨 판정),
               DamageView.ts(손상 자세·텍스처 적용), Invariants.ts(불변 조건)
  economy/     Wallet.ts, Modifiers.ts, FragmentValue.ts, BuildingLedger.ts, Economy.ts (순수 로직)
  game/        StateMachine.ts, Launcher.ts(발사대 인터페이스), Cannon.ts, Wizard.ts, fireball.ts,
               Projectile.ts(ProjectileSpec), BuildingFire.ts(화재 ↔ 파티클·색·라이트 연결)
  camera/      CutsceneCam.ts, AimCam.ts, ChaseCam.ts, SpectateCam.ts, CameraShake.ts
  fx/          Dust.ts, Sparks.ts, Fire.ts(불꽃·연기·불씨), FireballVisual.ts, LightPool.ts(고정 개수), Rebar.ts,
               MoneyPopups.ts(+$ 묶음 팝업), PostFX.ts
  ui/          HUD(대포 버튼, 파워 게이지, 리셋, 품질 선택), EconomyHud(돈·이번 건물 수익·파괴율 바), 디버그 GUI
  audio/       AudioManager.ts
tests/         vitest 단위 테스트
```

## 코딩 규칙
- 매직 넘버 금지 → `src/config.ts`에 튜닝 상수 모아두기(포탄 질량, 속도, 폭발 반경, 조각 수 등).
- 무거운 분할 계산은 **Web Worker**에서 (`fracture.worker.ts`), 메인 스레드는 로딩 진행률 표시.
- 같은 형태 반복이 아니므로 조각 메시는 `BatchedMesh` 사용, 재질은 외벽/단면/유리 3종 이하로 유지(드로우콜 최소화).
- 매 프레임 `new` 금지(Vector3 등 재사용 스크래치 객체 사용).
- 각 단계 끝에: `npm run build` 통과, `npm test` 통과, 콘솔 에러 0, FPS 확인 후 커밋.
- 커밋 메시지: `feat(fracture): ...`, `fix(physics): ...` 형식. 단계(Phase)마다 브랜치 → PR.

## 성능 목표
- 데스크톱 중급 GPU에서 Medium 프리셋, 붕괴 중에도 **55fps 이상**.
- 동적 조각 수 상한(예: 3000). 초과 시 작은 조각부터 제거하거나 파티클로 대체.
- 일정 시간 정지한 조각은 sleep, 화면 밖/지면 아래 조각은 제거.

## 하지 말 것
- 실시간 CSG/메시 분할 (성능 폭망).
- 저작권 있는 에셋(마리오 캐릭터, 닌텐도 사운드 등) 사용. 대포·연출은 "느낌"만 참고하고 전부 오리지널로.
- 외부 CDN 런타임 의존(에셋은 레포에 포함).
