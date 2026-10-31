// 수익 배율을 한 곳에서 합성한다. 지금은 주문 배율뿐이고, Phase 10 업그레이드·탤런트가 여기에 붙는다.
//
// 합성 규칙 (순서가 정해져 있다):
//   전체 = (1 + 가산 보너스 합) × 곱셈 배율들의 곱
//   - 가산(additive): "+20% 수익" 같은 보너스. 서로 더한다 (여러 개를 쌓아도 선형)
//   - 곱셈(multiplicative): 주문 배율 같은 독립 배율. 서로 곱한다
// 같은 이름으로 다시 넣으면 교체한다 (중복 적용 없음). 넣는 순서는 결과에 영향이 없다.

export type ModifierKind = 'additive' | 'multiplicative';

export class Modifiers {
  private readonly additive = new Map<string, number>();
  private readonly multiplicative = new Map<string, number>();

  /** name 배율을 넣거나 바꾼다. additive면 0.2 = +20%, multiplicative면 1.5 = ×1.5 */
  set(name: string, value: number, kind: ModifierKind = 'multiplicative'): this {
    (kind === 'additive' ? this.multiplicative : this.additive).delete(name);
    (kind === 'additive' ? this.additive : this.multiplicative).set(name, value);
    return this;
  }

  remove(name: string): this {
    this.additive.delete(name);
    this.multiplicative.delete(name);
    return this;
  }

  /** 합성된 전체 배율 */
  get total(): number {
    let bonus = 0;
    for (const v of this.additive.values()) bonus += v;
    let product = 1;
    for (const v of this.multiplicative.values()) product *= v;
    return (1 + bonus) * product;
  }
}
