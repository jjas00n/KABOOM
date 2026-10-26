// 진입점. 렌더러/물리/게임 루프 연결은 Phase 1에서.
const canvas = document.querySelector<HTMLCanvasElement>('#app');
if (!canvas) {
  throw new Error('#app canvas not found');
}
