# KABOOM — 진행 과정 & Claude Code 프롬프트

> 위치: `docs/ROADMAP.md` 에 두기. 각 Phase의 프롬프트를 Claude Code에 그대로 붙여넣으면 된다.
> 진행 체크는 아래 박스를 직접 체크하면서 관리.

## 사용법 (Claude Code 워크플로)
1. 레포 클론 → 루트에 `CLAUDE.md`, `docs/ROADMAP.md` 넣고 커밋.
2. 각 Phase 시작할 때 **Plan 모드**(Shift+Tab 두 번)로 프롬프트 입력 → 계획 확인 → 승인 후 구현.
3. Phase 끝나면 "검증" 항목을 직접 브라우저에서 확인 → 문제 있으면 그 자리에서 수정 요청.
4. Phase 단위로 브랜치/PR (`phase-2-fracture` 등). 막히면 `/clear` 후 "CLAUDE.md와 docs/ROADMAP.md 읽고 Phase N 이어서" 로 재개.
5. 컨텍스트가 길어지면 `/compact`.

---

## 진행 체크리스트
- [ ] Phase 0 — 프로젝트 셋업
- [ ] Phase 1 — 씬 + 물리 샌드박스
- [ ] Phase 2 — 보로노이 분할 엔진 ★
- [ ] Phase 3 — 절차적 건물 생성기 ★
- [ ] Phase 4 — 구조 무결성 & 연쇄 붕괴 ★
- [ ] Phase 5 — 대포 & 카메라 상태 머신
- [ ] Phase 6 — 사실적 그래픽 & 이펙트
- [ ] Phase 7 — UI / 사운드 / 연출 다듬기
- [ ] Phase 8 — 성능 최적화 & 배포

★ = 프로젝트 핵심. 여기서 시간을 제일 많이 쓴다.

---

## Phase 0 — 프로젝트 셋업
**프롬프트**
```
CLAUDE.md를 읽고 프로젝트를 셋업해줘.
- Vite + TypeScript(strict) 템플릿, three, @dimforge/rapier3d-compat, postprocessing, lil-gui, vitest 설치 (최신 안정 버전)
- CLAUDE.md의 디렉터리 구조대로 빈 모듈 파일 생성, src/config.ts에 튜닝 상수 자리 만들기
- ESLint + Prettier, npm scripts(dev/build/test/lint)
- .github/workflows/deploy.yml로 main 푸시 시 GitHub Pages 배포 (vite base 경로 '/KABOOM/')
- README에 실행 방법 정리
끝나면 npm run build, npm test가 통과하는지 확인해.
```
**검증**: `npm run dev` 빈 화면 에러 없이 뜸 / build·test 통과

---

## Phase 1 — 씬 + 물리 샌드박스
**프롬프트**
```
Phase 1: 기본 씬과 물리 루프를 만들어줘.
- Renderer(WebGL2, ACES 톤매핑, sRGB, 그림자 on), 지면, 방향광 + 환경광, 임시 OrbitControls
- core/Loop.ts: 물리 고정 timestep 60Hz + 렌더 보간(accumulator 방식), timeScale 지원(나중에 hit-stop/슬로모션용)
- physics/PhysicsWorld.ts: Rapier 초기화(async), rigidbody ↔ mesh 동기화, 충돌 이벤트 큐
- 테스트용: 박스 200개를 쌓고, 클릭하면 그 지점에 구 하나를 빠르게 발사
- lil-gui로 FPS, 바디 수, timeScale 표시/조절
```
**검증**: 박스 200개 무너뜨려도 60fps, timeScale 0.2에서 부드러운 슬로모션

---

## Phase 2 — 보로노이 분할 엔진 ★
**프롬프트**
```
Phase 2: 사전 분할(pre-fracture) 엔진을 만들어줘. 이게 이 프로젝트의 핵심이야.
- fracture/voronoi.ts: 입력 = 볼록 다면체(우선 박스) + 시드 점 배열. 각 시드마다 원본 다면체를 다른 시드들과의 수직이등분 평면으로 반공간 클리핑해서 볼록 셀을 만든다.
  - 가까운 시드만 검사하도록 공간 해시/kNN으로 가속
  - 결과 조각마다: 정점, 삼각형 인덱스, 법선, UV, 각 면이 "원래 외부면"인지 "절단 단면"인지 플래그(재질 그룹 분리용), 부피, 질량중심
- fracture/seeds.ts: 균일 랜덤, 지터 그리드, 특정 점 주변 밀집(적응형) 시드 생성
- 인접 정보: 두 셀이 같은 이등분 평면의 면을 공유하면 이웃으로 기록하고 공유 면적도 저장 (Phase 4 그래프용)
- fracture.worker.ts에서 돌리고 Transferable로 버퍼 전달
- vitest: 조각 부피 합 == 원본 부피(오차 1% 이내), 모든 조각이 볼록, 이웃 관계 대칭성
- 데모: 콘크리트 박스 1개(시드 300개)를 쪼개서 조각을 Rapier convexHull 바디로 만들고, 처음엔 fixed, 클릭하면 폭발 임펄스로 흩어지게
```
**검증**: 박스가 틈 없이 맞물려 보이다가 클릭하면 300조각으로 깨짐 / 단면 재질이 외면과 다르게 보임 / 테스트 통과

---

## Phase 3 — 절차적 건물 생성기 ★
**프롬프트**
```
Phase 3: 절차적 건물 생성기를 만들어줘.
- building/BuildingGenerator.ts: 파라미터(층수, 가로/세로 칸 수, 층고, 기둥 간격, 창문 비율, seed)로 사실적인 콘크리트 오피스 건물 생성
- 부재: 기초(지면 고정), 기둥, 보, 층 슬래브, 외벽 패널(창문 구멍 포함 → 창 주변을 여러 볼록 박스로 나눠 구성), 유리창, 옥상 난간
- 각 부재를 Phase 2 엔진으로 분할. 부재 종류별 시드 밀도를 config에서 조절 (외벽 패널 > 슬래브 > 기둥 순으로 잘게)
- 유리는 별도: 얇은 판을 잘게(크랙 느낌) 분할, 깨지면 가벼운 파편
- 부재 간 연결(기둥-슬래브, 패널-슬래브 등)도 인접 그래프에 포함
- 품질 프리셋 Low/Medium/High (총 조각 대략 1.5k/4k/8k), 생성 중 로딩 진행률 표시
- 렌더는 BatchedMesh, 재질은 외벽/단면/유리 3종
```
**검증**: 5~8층 건물이 멀쩡해 보임(틈/깜빡임 없음) / Medium에서 로딩 5초 이내 / 디버그 토글로 조각 경계 색칠 보기

---

## Phase 4 — 구조 무결성 & 연쇄 붕괴 ★
**프롬프트**
```
Phase 4: 건물이 '그럴듯하게' 무너지도록 구조 시스템을 만들어줘.
- building/StructureGraph.ts: 조각=노드, 인접=엣지(강도 = 공유면적 × 재질 계수). 기초 조각은 앵커
- destruction/Explosion.ts: 충돌 지점·운동에너지 기반으로 반경 내 엣지 파괴 + 조각들을 dynamic으로 전환하고 거리 감쇠 임펄스 적용
- destruction/CollapseSolver.ts: 엣지가 끊길 때마다 앵커에서 BFS → 도달 못 하는 덩어리(섬)를 찾아냄
  - 섬은 처음엔 하나의 compound 강체로 떨어뜨리고(성능+사실감), 지면/다른 조각과 큰 충격으로 부딪히면 내부 엣지를 끊어 개별 조각으로 분해
  - 하중 근사: 섬이 아니더라도 위층 질량에 비해 남은 지지 엣지 강도가 부족하면 점진적으로 끊김 (기둥 날아가면 그 위가 주저앉게)
- 동적 조각 끼리 큰 충격 시 추가 파괴(연쇄)
- DebrisManager: 동적 조각 상한, 오래 멈춘 조각 sleep, 작은 조각은 시간 지나면 페이드아웃
- 디버그: 그래프 엣지 시각화, 앵커 표시
- 테스트: 1층 기둥 전부 제거 시 상부 전체가 섬으로 판정되는지 vitest
```
**검증**: 옆면 맞추면 구멍만 뚫림 / 1층 모서리 기둥 쪽 맞추면 한쪽이 기울며 무너짐 / 붕괴 중 55fps 이상(Medium)

---

## Phase 5 — 대포 & 카메라 상태 머신
**프롬프트**
```
Phase 5: 마리오64 대포 '느낌'의 게임 흐름을 만들어줘 (에셋/디자인은 전부 오리지널).
- game/StateMachine.ts: IDLE → CANNON_CUTSCENE → AIMING → PROJECTILE_CAM → IMPACT → SPECTATE (CLAUDE.md 다이어그램대로)
- game/Cannon.ts: 건물에서 떨어진 언덕 위 대포(절차적 메시: 포신+받침), 지면에서 솟아오르는 등장 애니메이션
- camera/CutsceneCam.ts: 건물 전경 → 대포로 날아가는 스플라인 비행(약 3초, easeInOut), 클릭/Space로 스킵
- camera/AimCam.ts: 포신 시점, 마우스 yaw/pitch(각도 제한), 휠로 파워, 크로스헤어 + 예상 궤적 점선, 포신이 같이 회전
- game/Projectile.ts: 무겁고 빠른 포탄(CCD 켜기 - 터널링 방지), 발사 시 반동·연기
- camera/ChaseCam.ts: 포탄 뒤 체이스 캠, 스무딩
- 충돌 시: Explosion 호출 → IMPACT(timeScale 0.15로 0.3초 hit-stop + 카메라 흔들림) → SPECTATE로 전환
- camera/SpectateCam.ts: 처음 4초는 충돌 지점을 바라보며 천천히 도는 자동 연출, 이후 OrbitControls로 자유 관람
- 카메라 전환은 전부 부드러운 블렌딩(뚝 끊김 없이)
```
**검증**: 버튼 한 번으로 컷신→조준→발사→포탄 시점→충돌→건물 시점까지 끊김 없이 / 연속 발사 가능 / 포탄이 벽을 뚫고 지나가는 버그 없음

---

## Phase 6 — 사실적 그래픽 & 이펙트
**프롬프트**
```
Phase 6: 사실적인 콘크리트/유리 비주얼로 끌어올려줘.
- ambientCG/Poly Haven CC0 텍스처(콘크리트 외벽, 거친 내부 콘크리트, 지면) 1K로 받아 public/textures에 넣고 CREDITS.md 작성. HDRI 1K 환경맵
- 조각 UV: 외부면은 원래 부재 기준 박스 투영(조각 나도 텍스처가 이어지게), 단면은 트라이플래너
- 유리: MeshPhysicalMaterial (transmission 성능 부담되면 반투명+환경반사로 대체 옵션)
- 그림자: 붕괴 영역 위주로 shadow camera 범위 동적 조정
- fx/Dust.ts: 충돌·조각 지면 충돌 시 먼지 구름(소프트 파티클, 시간에 따라 퍼지고 옅어짐)
- 작은 부스러기: 시각 전용 GPU 인스턴스 파티클(물리 없음)로 조각 수 부풀리기
- PostFX: SMAA, N8AO(SSAO), 약한 Bloom(폭발 섬광), 비네트, 충돌 순간 짧은 모션블러/색수차(옵션)
```
**검증**: 스크린샷이 '게임 같은 프로토타입'이 아니라 사실적으로 보임 / 단면이 외면과 확실히 구분 / 여전히 55fps 이상

---

## Phase 7 — UI / 사운드 / 연출 다듬기
**프롬프트**
```
Phase 7: 완성도를 올려줘.
- HUD: 대포 버튼, 파워 게이지, 리셋, 품질 프리셋, 건물 시드/층수 변경, 파괴율(%) 표시
- AudioManager(Web Audio): 발사 쿵, 비행 휘파람, 충돌 폭음, 콘크리트 부서짐/유리 깨짐(충격량 기반 볼륨·피치 랜덤), 거리 감쇠. 효과음은 CC0(freesound CC0) 또는 Web Audio로 합성
- 리플레이: 마지막 발사를 스펙테이트 카메라로 슬로모션 재생(물리 상태 기록 or 재시뮬레이션 중 쉬운 쪽)
- 모바일 터치: 드래그 조준, 버튼 크기
```
**검증**: 처음 보는 사람이 설명 없이 플레이 가능 / 소리가 화면과 맞음

---

## Phase 8 — 성능 최적화 & 배포
**프롬프트**
```
Phase 8: 최적화하고 배포해줘.
- 프로파일링(Chrome Performance)으로 병목 찾기: 물리 스텝, 메시 동기화, 드로우콜
- 동적 조각 상한/정리 정책 튜닝, 화면 밖 조각 동기화 생략, 필요시 Rapier 스텝을 워커로
- FPS가 일정 시간 기준 이하면 자동으로 품질 프리셋 낮추기
- 번들 크기 확인, 텍스처 KTX2 압축(가능하면)
- GitHub Pages 배포 확인, README에 GIF/스크린샷과 조작법
```
**검증**: 배포 URL에서 정상 동작 / 노트북 내장 GPU에서 Low 프리셋 45fps 이상

---

## 막혔을 때 쓰는 프롬프트
- 버그: `지금 [현상]이 생겨. 재현 방법은 [...]. 원인부터 분석하고 수정안을 제시한 다음 고쳐줘. 고친 뒤 회귀 테스트도 추가해.`
- 성능: `붕괴 중 FPS가 [N]까지 떨어져. 프로파일 기준으로 병목 후보를 순서대로 나열하고, 가장 효과 큰 것부터 하나씩 적용하면서 측정해줘.`
- 비주얼: `[스크린샷 첨부] 이게 너무 [밋밋/가짜 같음]해. 사실적으로 보이게 하려면 뭘 바꿔야 할지 우선순위로 제안하고 적용해줘.`
- 재개: `CLAUDE.md와 docs/ROADMAP.md 읽고, git log로 어디까지 했는지 확인한 뒤 Phase N 이어서 진행해.`
