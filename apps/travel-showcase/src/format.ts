const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Canonical whole-rupee display used by the board, approvals and trace. */
export function money(value: number): string {
  return `₹${INR.format(value)}`;
}
