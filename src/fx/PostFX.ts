// 포스트프로세싱 체인: 장면(HDR) → N8AO(SSAO) → Bloom + ACES 톤매핑 + 비네트 → SMAA → 충돌 펄스
// - 장면은 HalfFloat 버퍼에 톤매핑 없이 그리고, 톤매핑은 Bloom 뒤에 한다 (섬광처럼 1 넘는 빛만 번지게).
// - 충돌 펄스: 방사형 블러 + 색수차를 한 셰이더로 (둘 다 주변 픽셀을 읽는 효과라 한 패스에 하나만 넣을 수 있다).
//   진짜 속도 버퍼 모션블러 대신 저비용 근사. 펄스가 없으면 패스를 꺼서 비용 0.
// - 엑스레이 킬캠 중엔 AO/Bloom을 끈다 (반투명 유령 화면에 AO가 얼룩진다).
// 패스는 한 번만 만들고 켜고 끄기만 한다 (다시 만들면 셰이더를 다시 컴파일해 끊긴다).
// 끄고 켤 때마다 화면 출력(renderToScreen)을 켜진 마지막 패스로 옮긴다.
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import {
  HalfFloatType,
  NoToneMapping,
  Uniform,
  Vector2,
  type PerspectiveCamera,
  type Scene,
  type ToneMapping,
  type WebGLRenderer,
} from 'three';
import { POSTFX } from '../config';

const IMPACT_FRAGMENT = /* glsl */ `
uniform float strength;
uniform float aberration;
void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec2 dir = uv - vec2( 0.5 );
  vec3 sum = vec3( 0.0 );
  for ( int i = 0; i < SAMPLES; i++ ) {
    vec2 p = uv - dir * strength * ( float( i ) / float( SAMPLES - 1 ) );
    sum.r += texture2D( inputBuffer, p - dir * aberration ).r;
    sum.g += texture2D( inputBuffer, p ).g;
    sum.b += texture2D( inputBuffer, p + dir * aberration ).b;
  }
  outputColor = vec4( sum / float( SAMPLES ), inputColor.a );
}`;

/** 화면 중심으로 끌려가는 방사형 블러 + 색수차 */
class ImpactEffect extends Effect {
  constructor() {
    super('ImpactEffect', IMPACT_FRAGMENT, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      defines: new Map([['SAMPLES', String(POSTFX.pulseSamples)]]),
      uniforms: new Map([
        ['strength', new Uniform(0)],
        ['aberration', new Uniform(0)],
      ]),
    });
  }

  /** 0 ~ 1 */
  setAmount(k: number): void {
    this.uniforms.get('strength')!.value = POSTFX.pulseBlur * k;
    this.uniforms.get('aberration')!.value = POSTFX.pulseAberration * k;
  }
}

/** 디버그 GUI가 만지는 토글. 바꾼 뒤 PostFX.apply() */
export interface PostFXSettings {
  enabled: boolean;
  ao: boolean;
  smaa: boolean;
  bloom: boolean;
  vignette: boolean;
  impactPulse: boolean;
}

export class PostFX {
  readonly settings: PostFXSettings = {
    enabled: POSTFX.enabled,
    ao: POSTFX.ao,
    smaa: POSTFX.smaa,
    bloom: POSTFX.bloom,
    vignette: POSTFX.vignette,
    impactPulse: POSTFX.impactPulse,
  };
  private readonly composer: EffectComposer;
  private readonly aoPass: N8AOPostPass;
  private readonly bloom: BloomEffect;
  private readonly vignette: VignetteEffect;
  private readonly smaaPass: EffectPass;
  private readonly impact = new ImpactEffect();
  private readonly impactPass: EffectPass;
  /** 후처리를 끄면 렌더러가 직접 톤매핑한다 */
  private readonly rendererToneMapping: ToneMapping;
  private pulseLeft = 0;
  private pulseStrength = 0;
  private xray = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
  ) {
    this.rendererToneMapping = renderer.toneMapping;
    this.composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
    this.composer.addPass(new RenderPass(scene, camera));

    const size = renderer.getDrawingBufferSize(new Vector2());
    this.aoPass = new N8AOPostPass(scene, camera, size.x, size.y);
    const c = this.aoPass.configuration;
    c.aoRadius = POSTFX.aoRadius;
    c.intensity = POSTFX.aoIntensity;
    c.distanceFalloff = POSTFX.aoDistanceFalloff;
    c.halfRes = POSTFX.aoHalfRes;
    c.gammaCorrection = false; // postprocessing이 마지막에 sRGB 변환을 한다
    this.aoPass.setQualityMode(POSTFX.aoQuality);
    this.composer.addPass(this.aoPass);

    this.bloom = new BloomEffect({
      intensity: POSTFX.bloomIntensity,
      luminanceThreshold: POSTFX.bloomThreshold,
      luminanceSmoothing: POSTFX.bloomSmoothing,
      mipmapBlur: true,
    });
    this.vignette = new VignetteEffect({
      offset: POSTFX.vignetteOffset,
      darkness: POSTFX.vignetteDarkness,
    });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.composer.addPass(new EffectPass(camera, this.bloom, toneMapping, this.vignette));
    this.smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.composer.addPass(this.smaaPass);
    this.impactPass = new EffectPass(camera, this.impact);
    this.composer.addPass(this.impactPass);
    this.apply();
  }

  /** settings를 반영한다 (GUI 토글 뒤) */
  apply(): void {
    const s = this.settings;
    this.renderer.toneMapping = s.enabled ? NoToneMapping : this.rendererToneMapping;
    this.aoPass.enabled = s.ao && !this.xray;
    this.bloom.blendMode.opacity.value = s.bloom && !this.xray ? 1 : 0;
    this.vignette.blendMode.opacity.value = s.vignette ? 1 : 0;
    this.smaaPass.enabled = s.smaa;
    this.updatePulse(0);
    this.routeOutput();
  }

  /** 엑스레이 킬캠 켜짐/꺼짐 */
  setXRay(on: boolean): void {
    if (this.xray === on) return;
    this.xray = on;
    this.apply();
  }

  /** 충돌 순간: 방사형 블러 + 색수차를 strength(0~1)로 걸고 pulseSec 동안 감쇠 */
  pulse(strength = 1): void {
    this.pulseStrength = this.pulseLeft > 0 ? Math.max(strength, this.pulseStrength) : strength;
    this.pulseLeft = POSTFX.pulseSec;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** dt: 실제 경과 시간 (펄스 감쇠) */
  render(dt: number): void {
    if (!this.settings.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.updatePulse(dt);
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }

  private updatePulse(dt: number): void {
    this.pulseLeft = Math.max(0, this.pulseLeft - dt);
    const t = this.pulseLeft / POSTFX.pulseSec;
    const k = this.settings.impactPulse ? this.pulseStrength * t * t : 0;
    this.impact.setAmount(k);
    const on = k > 1e-3;
    if (on === this.impactPass.enabled) return;
    this.impactPass.enabled = on;
    this.routeOutput();
  }

  /** 켜진 패스 중 마지막 것만 화면에 그린다 (꺼진 마지막 패스에 맡기면 화면에 아무것도 안 나온다) */
  private routeOutput(): void {
    const passes = this.composer.passes;
    let last = true;
    for (let i = passes.length - 1; i >= 0; i--) {
      const pass = passes[i]!;
      pass.renderToScreen = pass.enabled && last;
      if (pass.enabled) last = false;
    }
  }
}
