//! Scalar fields: the Glyph Lab's "channels". Each is a pure function `(x, y, t) → brightness` on a
//! unit square (x, y ∈ [0, 1], aspect-corrected) and loops seamlessly every `loop_s` seconds.

use serde::{Deserialize, Serialize};
use crate::math::{clamp01, fbm, hash2, smoothstep, vnoise};
use std::f32::consts::{PI, TAU};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Channel { #[default] Horizon, Tide, Signal, Plasma, Rain, Iris, Bloom, Dunes, Tunnel, Clouds, Text, Logo, Static, Scan }

impl Channel {
  pub const ALL: [Channel; 14] = [Channel::Horizon, Channel::Tide, Channel::Signal, Channel::Plasma, Channel::Rain, Channel::Iris, Channel::Bloom, Channel::Dunes, Channel::Tunnel, Channel::Clouds, Channel::Text, Channel::Logo, Channel::Static, Channel::Scan];
  pub fn label(self) -> (&'static str, &'static str) {
    match self {
      Channel::Horizon => ("Horizon", "Planet edge, orbiting sparks"), Channel::Tide => ("Tide", "A wave that covers the frame"), Channel::Signal => ("Signal", "TV static, rolling bar"),
      Channel::Plasma => ("Plasma", "Liquid interference"), Channel::Rain => ("Rain", "Falling columns"), Channel::Iris => ("Iris", "Circle opens and shuts"), Channel::Bloom => ("Bloom", "Breathing glow"),
      Channel::Dunes => ("Dunes", "Rolling landscape"), Channel::Tunnel => ("Tunnel", "Endless checker tunnel"), Channel::Clouds => ("Clouds", "Soft drifting noise"),
      Channel::Text => ("Layer: Text", "Your words as characters"), Channel::Logo => ("Layer: Logo", "A shape as characters"), Channel::Static => ("Static", "Pure noise, no motion"), Channel::Scan => ("Scan", "A bright line sweeps down"),
    }
  }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction { #[default] Forward, Reverse, PingPong }

/// Field transform and playback (the Field tab).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct FieldParams {
  pub channel: Channel,
  pub zoom: f32,
  /// Degrees.
  pub rotate: f32,
  pub pan_x: f32,
  pub pan_y: f32,
  /// Domain warp amount (0 = none).
  pub warp: f32,
  /// Noise octaves 1..6.
  pub detail: u32,
  pub speed: f32,
  pub direction: Direction,
  pub seed: u32,
  /// Loop length in seconds; the field is periodic in this.
  pub loop_s: f32,
}
impl Default for FieldParams {
  fn default() -> Self { FieldParams { channel: Channel::Horizon, zoom: 1.0, rotate: 0.0, pan_x: 0.0, pan_y: 0.0, warp: 0.0, detail: 4, speed: 1.0, direction: Direction::Forward, seed: 1, loop_s: 4.0 } }
}

impl FieldParams {
  /// Loop phase in [0, 1) for a time, honouring direction. Forward/reverse wrap; ping-pong bounces.
  pub fn phase(&self, t: f32) -> f32 {
    let l = self.loop_s.max(0.1);
    let u = (t * self.speed / l).rem_euclid(1.0);
    match self.direction {
      Direction::Forward => u,
      Direction::Reverse => 1.0 - u,
      Direction::PingPong => { let v = (t * self.speed / l * 0.5).rem_euclid(1.0); if v < 0.5 { v * 2.0 } else { 2.0 - v * 2.0 } }
    }
  }
  /// Map a cell centre (0..1, aspect `a` = w/h) through zoom, rotate, pan and warp.
  #[inline]
  fn xform(&self, x: f32, y: f32, aspect: f32, ph: f32) -> (f32, f32) {
    let (mut u, mut v) = ((x - 0.5) * aspect, y - 0.5);
    if self.rotate != 0.0 { let r = self.rotate.to_radians(); let (s, c) = r.sin_cos(); let (ru, rv) = (u * c - v * s, u * s + v * c); u = ru; v = rv; }
    let z = self.zoom.max(0.05);
    u = u / z + self.pan_x; v = v / z + self.pan_y;
    if self.warp > 0.0 {
      let a = ph * TAU;
      u += self.warp * 0.25 * (vnoise(u * 3.0 + a.cos(), v * 3.0 + a.sin(), 0.0, self.seed + 11) - 0.5);
      v += self.warp * 0.25 * (vnoise(u * 3.0 - a.sin(), v * 3.0 + a.cos(), 1.0, self.seed + 23) - 0.5);
    }
    (u, v)
  }

  /// Brightness at a cell. `x`, `y` are in [0, 1] (cell centres), `t` seconds.
  pub fn sample(&self, x: f32, y: f32, aspect: f32, t: f32) -> f32 {
    let ph = self.phase(t);
    let a = ph * TAU; // loop angle: everything periodic uses sin/cos of this so t = 0 and t = loop match
    let (u, v) = self.xform(x, y, aspect, ph);
    let s = self.seed;
    let oct = self.detail.clamp(1, 6);
    match self.channel {
      Channel::Horizon => {
        // A planet's limb: a huge dark disc rising from below, a hot rim, glow fading into space,
        // sparks riding the edge and a faint atmosphere band. The planet's face stays dark.
        let (cx, cy, r) = (0.0, 1.55, 1.42);
        let d = ((u - cx).powi(2) + (v - cy).powi(2)).sqrt() - r;
        let rim = (1.0 - (d.abs() * 22.0)).max(0.0).powf(1.3);
        let glow = if d > 0.0 { (-d * 6.0).exp() * 0.8 } else { (d * 30.0).exp() * 0.55 };
        let surface = if d < 0.0 { (0.03 + 0.16 * fbm(u * 5.0 + a.cos() * 0.25, v * 5.0 + a.sin() * 0.25, 0.0, oct, s)) * (1.0 + d * 3.0).max(0.0) } else { 0.0 };
        let ang = (v - cy).atan2(u - cx);
        let lane = (1.0 - ((d - 0.03) * 60.0).abs()).max(0.0);
        // Sparks: sparse points orbiting just above the rim, each twinkling on its own phase.
        let k = (ang * 340.0 + a * 4.0).floor() as i32;
        let spark = if hash2(k, 0, s) > 0.955 { lane * (0.6 + 0.4 * (a * 3.0 + hash2(k, 1, s) * 6.28).sin()) } else { 0.0 };
        let stars = if d > 0.08 && hash2(((u + 9.0) * 90.0) as i32, ((v + 9.0) * 90.0) as i32, s + 3) > 0.993 { 0.35 + 0.35 * (a * 3.0 + u * 40.0).sin().abs() } else { 0.0 };
        let shimmer = 0.85 + 0.15 * (ang * 24.0 - a * 2.0).sin();
        clamp01(surface + glow * shimmer + rim + spark + stars)
      }
      Channel::Tide => {
        let crest = 0.5 + 0.35 * (a).sin();
        let wobble = 0.08 * (u * 6.0 + a * 2.0).sin() + 0.04 * fbm(u * 5.0, v * 5.0, ph * 2.0, oct, s);
        let edge = (v + 0.5) - (crest + wobble);
        clamp01(smoothstep(-0.25, 0.05, edge) * 0.8 + (1.0 - (edge * 18.0).abs()).max(0.0))
      }
      Channel::Signal => {
        let noise = hash2(((u + 20.0) * 400.0) as i32, ((v + 20.0) * 220.0 + (ph * 7.0).floor() * 13.0) as i32, s);
        let bar = (1.0 - (((v + 0.5) - ph).rem_euclid(1.0) * 6.0 - 0.3).abs().min(1.0)).max(0.0);
        let tear = if hash2(((v + 0.5) * 40.0) as i32, (ph * 12.0) as i32, s + 5) > 0.9 { 0.4 } else { 0.0 };
        clamp01(noise * 0.6 + bar * 0.5 + tear)
      }
      Channel::Plasma => {
        let p = (u * 5.0 + a.sin() * 1.5).sin() + ((v * 5.0 + a.cos()) * 1.1).sin() + ((u + v) * 4.0 + a * 1.0).sin() + ((u * u + v * v).sqrt() * 9.0 - a * 2.0).sin();
        clamp01(0.5 + p / 8.0 * 1.4 + (fbm(u * 3.0, v * 3.0, ph, oct, s) - 0.5) * 0.4)
      }
      Channel::Rain => {
        let col = ((u + 10.0) * 48.0).floor() as i32;
        let spd = 0.6 + hash2(col, 0, s) * 1.4;
        let len = 0.15 + hash2(col, 1, s) * 0.35;
        let off = hash2(col, 2, s);
        let y = ((v + 0.5) - (ph * spd * 3.0 + off)).rem_euclid(1.0);
        let head = (1.0 - (y / len)).max(0.0);
        let glint = if y < 0.02 { 1.0 } else { 0.0 };
        clamp01(head.powf(1.5) * 0.85 + glint + fbm(u * 20.0, v * 20.0, ph * 4.0, 2, s) * 0.08)
      }
      Channel::Iris => {
        let r = (u * u + v * v).sqrt();
        let open = 0.5 - 0.5 * a.cos();
        let radius = open * 0.75;
        let ring = (1.0 - ((r - radius) * 16.0).abs()).max(0.0);
        let fill = smoothstep(radius + 0.02, radius - 0.08, r) * 0.9;
        clamp01(fill * (0.6 + 0.4 * fbm(u * 8.0, v * 8.0, ph, oct, s)) + ring)
      }
      Channel::Bloom => {
        let r = (u * u + v * v).sqrt();
        let breathe = 0.85 + 0.25 * a.sin();
        let core = (-(r * 3.2 / breathe).powi(2)).exp();
        let halo = (-(r * 1.4 / breathe).powi(2)).exp() * 0.35;
        clamp01(core + halo + (fbm(u * 10.0, v * 10.0, ph * 2.0, oct, s) - 0.5) * 0.15)
      }
      Channel::Dunes => {
        let h = fbm(u * 2.2 + a.cos() * 0.4, v * 1.3 + a.sin() * 0.15 + 0.5, 0.0, oct, s);
        let ridges = 1.0 - (2.0 * (h * 3.0 - (h * 3.0).floor()) - 1.0).abs();
        let horizon = smoothstep(-0.5, 0.5, v + 0.2);
        clamp01(h * 0.5 + ridges * 0.35 * horizon + 0.1 * horizon)
      }
      Channel::Tunnel => {
        let r = (u * u + v * v).sqrt().max(0.001);
        let ang = v.atan2(u);
        let depth = 0.25 / r + ph * 2.0;
        let checker = (((depth * 4.0).floor() as i32 + ((ang / PI * 6.0).floor() as i32)) & 1) as f32;
        let fog = clamp01(r * 2.8);
        clamp01((0.25 + checker * 0.6) * fog + (1.0 - fog) * 0.05)
      }
      Channel::Clouds => {
        let n = fbm(u * 2.5 + a.cos() * 0.6, v * 2.5 + a.sin() * 0.6, ph * 0.5, oct, s);
        clamp01(smoothstep(0.3, 0.8, n))
      }
      Channel::Static => hash2(((u + 20.0) * 400.0) as i32, ((v + 20.0) * 400.0) as i32, s.wrapping_add((ph * 24.0) as u32)),
      Channel::Scan => {
        let line = ((v + 0.5) - ph).rem_euclid(1.0);
        clamp01((1.0 - line * 3.0).max(0.0).powf(2.0) + if line < 0.015 { 1.0 } else { 0.0 } + fbm(u * 8.0, v * 8.0, 0.0, 2, s) * 0.1)
      }
      // Text and Logo are layer-driven: the renderer samples a mask instead. Treat as a soft plate here.
      Channel::Text | Channel::Logo => clamp01(0.5 + 0.5 * (u * 8.0 + a).sin() * (v * 8.0 - a).cos()),
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn fields_loop_seamlessly_and_stay_bounded() {
    for ch in Channel::ALL {
      let p = FieldParams { channel: ch, loop_s: 4.0, ..Default::default() };
      for (x, y) in [(0.1, 0.2), (0.5, 0.5), (0.9, 0.95), (0.33, 0.66)] {
        let a = p.sample(x, y, 16.0 / 9.0, 0.0);
        let b = p.sample(x, y, 16.0 / 9.0, 4.0);
        assert!((0.0..=1.0).contains(&a), "{ch:?} range {a}");
        assert!((a - b).abs() < 1e-3, "{ch:?} at ({x},{y}) does not loop: {a} vs {b}");
      }
    }
  }
  #[test]
  fn pingpong_bounces() {
    let p = FieldParams { direction: Direction::PingPong, loop_s: 2.0, ..Default::default() };
    assert!((p.phase(0.0)).abs() < 1e-6); assert!((p.phase(2.0) - 1.0).abs() < 1e-6); assert!((p.phase(4.0)).abs() < 1e-6);
  }
  #[test]
  fn horizon_has_a_bright_rim() {
    let p = FieldParams::default();
    let mut best = 0.0f32;
    for i in 0..200 { best = best.max(p.sample(0.5, i as f32 / 200.0, 16.0 / 9.0, 1.0)); }
    assert!(best > 0.9);
  }
}
