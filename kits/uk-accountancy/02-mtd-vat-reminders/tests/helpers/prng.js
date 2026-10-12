/**
 * Seeded generator so property tests are reproducible and CI never flakes.
 * Small seeds make a bare xorshift emit tiny first values, which would make the
 * first draws of every test nearly identical, so the state is stirred first.
 */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

export function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
export function int(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
