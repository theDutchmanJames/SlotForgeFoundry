export const add3 = (a, b) => a.map((x, i) => x + b[i]);
export const sub3 = (a, b) => a.map((x, i) => x - b[i]);
export const mul3 = (a, k) => a.map((x) => x * k);
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length3 = (a) => Math.hypot(...a);
export const unit3 = (a) => {
  const n = length3(a);
  return n ? mul3(a, 1 / n) : [0, 0, 0];
};
