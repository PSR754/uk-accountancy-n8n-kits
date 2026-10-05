/** Seeded generator so property tests are reproducible and CI never flakes. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
export function int(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
