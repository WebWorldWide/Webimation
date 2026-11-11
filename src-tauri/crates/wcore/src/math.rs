//! Deterministic maths: hashing, noise, easing. Everything here is a pure function of its inputs
//! so a frame rendered on any machine, in any order, comes out identical.

#[inline]
pub fn clamp01(x: f32) -> f32 { x.max(0.0).min(1.0) }
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }
#[inline]
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp01((x - e0) / (e1 - e0)); t * t * (3.0 - 2.0 * t) }
#[inline]
pub fn fract(x: f32) -> f32 { x - x.floor() }

/// 32-bit integer hash (lowbias32). Fast, well distributed, identical on every platform.
#[inline]
pub fn hash_u32(mut x: u32) -> u32 {
  x ^= x >> 16; x = x.wrapping_mul(0x7feb_352d); x ^= x >> 15; x = x.wrapping_mul(0x846c_a68b); x ^= x >> 16; x
}
/// Hash of up to three lattice coordinates and a seed → [0, 1).
#[inline]
pub fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  let h = hash_u32((x as u32).wrapping_mul(0x8da6_b343) ^ (y as u32).wrapping_mul(0xd8163841) ^ (z as u32).wrapping_mul(0xcb1a_b31f) ^ seed.wrapping_mul(0x9e37_79b9));
  (h >> 8) as f32 / 16_777_216.0
}
#[inline]
pub fn hash2(x: i32, y: i32, seed: u32) -> f32 { hash3(x, y, 0, seed) }

/// Value noise in [0, 1] with a smooth interpolant.
pub fn vnoise(x: f32, y: f32, z: f32, seed: u32) -> f32 {
  let (xi, yi, zi) = (x.floor(), y.floor(), z.floor());
  let (fx, fy, fz) = (x - xi, y - yi, z - zi);
  let (ux, uy, uz) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy), fz * fz * (3.0 - 2.0 * fz));
  let (xi, yi, zi) = (xi as i32, yi as i32, zi as i32);
  let c = |dx: i32, dy: i32, dz: i32| hash3(xi + dx, yi + dy, zi + dz, seed);
  let x00 = lerp(c(0, 0, 0), c(1, 0, 0), ux);
  let x10 = lerp(c(0, 1, 0), c(1, 1, 0), ux);
  let x01 = lerp(c(0, 0, 1), c(1, 0, 1), ux);
  let x11 = lerp(c(0, 1, 1), c(1, 1, 1), ux);
  lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz)
}

/// Fractal Brownian motion: `octaves` layers of value noise, normalised to [0, 1].
pub fn fbm(x: f32, y: f32, z: f32, octaves: u32, seed: u32) -> f32 {
  let (mut sum, mut amp, mut norm, mut f) = (0.0, 0.5, 0.0, 1.0);
  for o in 0..octaves.max(1) {
    sum += amp * vnoise(x * f, y * f, z * f, seed.wrapping_add(o * 131));
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  sum / norm
}

/// Small deterministic PRNG (xorshift) for sequences that need more than one draw.
#[derive(Clone, Copy, Debug)]
pub struct Rng(pub u32);
impl Rng {
  pub fn new(seed: u32) -> Self { Rng(hash_u32(seed ^ 0xA511_E9B3) | 1) }
  #[inline]
  pub fn next_u32(&mut self) -> u32 { let mut x = self.0; x ^= x << 13; x ^= x >> 17; x ^= x << 5; self.0 = x; x }
  #[inline]
  pub fn next_f32(&mut self) -> f32 { (self.next_u32() >> 8) as f32 / 16_777_216.0 }
  pub fn range(&mut self, lo: f32, hi: f32) -> f32 { lo + (hi - lo) * self.next_f32() }
  pub fn below(&mut self, n: u32) -> u32 { if n == 0 { 0 } else { self.next_u32() % n } }
}

/// Easing curves. Names match the UI: Calm / Normal / Snappy pick among these.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Ease {
  Linear,
  #[default]
  QuartOut,
  QuartIn,
  QuartInOut,
  CubicOut,
  CubicIn,
  BackOut,
  BounceOut,
  ElasticOut,
  /// Hard steps: 4, 8 or 16 frames.
  Steps4,
  Steps8,
  Steps16,
}
impl Ease {
  pub fn apply(self, t: f32) -> f32 {
    let t = clamp01(t);
    match self {
      Ease::Linear => t,
      Ease::QuartOut => 1.0 - (1.0 - t).powi(4),
      Ease::QuartIn => t.powi(4),
      Ease::QuartInOut => if t < 0.5 { 8.0 * t.powi(4) } else { 1.0 - (-2.0 * t + 2.0).powi(4) / 2.0 },
      Ease::CubicOut => 1.0 - (1.0 - t).powi(3),
      Ease::CubicIn => t.powi(3),
      Ease::BackOut => { let c1 = 1.70158; let c3 = c1 + 1.0; 1.0 + c3 * (t - 1.0).powi(3) + c1 * (t - 1.0).powi(2) }
      Ease::BounceOut => bounce(t),
      Ease::ElasticOut => if t <= 0.0 { 0.0 } else if t >= 1.0 { 1.0 } else { let c4 = std::f32::consts::TAU / 3.0; 2f32.powf(-10.0 * t) * ((t * 10.0 - 0.75) * c4).sin() + 1.0 },
      Ease::Steps4 => (t * 4.0).floor().min(4.0) / 4.0,
      Ease::Steps8 => (t * 8.0).floor().min(8.0) / 8.0,
      Ease::Steps16 => (t * 16.0).floor().min(16.0) / 16.0,
    }
  }
}
fn bounce(t: f32) -> f32 {
  let (n1, d1) = (7.5625, 2.75);
  if t < 1.0 / d1 { n1 * t * t }
  else if t < 2.0 / d1 { let t = t - 1.5 / d1; n1 * t * t + 0.75 }
  else if t < 2.5 / d1 { let t = t - 2.25 / d1; n1 * t * t + 0.9375 }
  else { let t = t - 2.625 / d1; n1 * t * t + 0.984375 }
}

/// Linear progress of a window `[start, start + dur]` at time `t`, clamped to [0, 1].
#[inline]
pub fn progress(t: f32, start: f32, dur: f32) -> f32 { if dur <= 0.0 { if t >= start { 1.0 } else { 0.0 } } else { clamp01((t - start) / dur) } }

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn hashes_are_stable_and_uniform() {
    assert_eq!(hash_u32(1), hash_u32(1));
    assert_ne!(hash_u32(1), hash_u32(2));
    let mut buckets = [0u32; 8];
    for i in 0..8000 { buckets[(hash2(i, i * 7, 3) * 8.0) as usize] += 1; }
    for b in buckets { assert!(b > 800 && b < 1200, "{b}"); }
  }
  #[test]
  fn noise_is_bounded_and_smooth() {
    let mut last = vnoise(0.0, 0.3, 0.7, 1);
    for i in 1..200 { let v = vnoise(i as f32 * 0.01, 0.3, 0.7, 1); assert!((0.0..=1.0).contains(&v)); assert!((v - last).abs() < 0.05); last = v; }
    assert!((0.0..=1.0).contains(&fbm(3.3, 9.1, 0.2, 5, 9)));
  }
  #[test]
  fn eases_hit_their_ends() {
    for e in [Ease::Linear, Ease::QuartOut, Ease::QuartIn, Ease::QuartInOut, Ease::CubicOut, Ease::CubicIn, Ease::BackOut, Ease::BounceOut, Ease::ElasticOut, Ease::Steps4, Ease::Steps8, Ease::Steps16] {
      assert!((e.apply(0.0)).abs() < 1e-5, "{e:?} start");
      assert!((e.apply(1.0) - 1.0).abs() < 1e-5, "{e:?} end");
    }
    assert_eq!(Ease::Steps4.apply(0.3), 0.25);
  }
}
