// 셰이더 공용 노이즈 조각 (파이어볼 셸, 조각 불씨)

/** 해시 기반 3D 값 노이즈 (0~1) — 셰이더 공용 조각 */
export const NOISE_GLSL = /* glsl */ `
float kHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float kNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( kHash( i ), kHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( kHash( i + vec3( 0, 1, 0 ) ), kHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( kHash( i + vec3( 0, 0, 1 ) ), kHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( kHash( i + vec3( 0, 1, 1 ) ), kHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
float kFbm( vec3 p ) {
  return 0.55 * kNoise( p ) + 0.3 * kNoise( p * 2.03 ) + 0.15 * kNoise( p * 4.01 );
}`;
