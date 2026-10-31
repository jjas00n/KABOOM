// 화면 표시용 숫자 형식
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** $1,234 (1달러 미만은 $0) */
export function formatMoney(amount: number): string {
  return `$${whole.format(Math.floor(amount))}`;
}
