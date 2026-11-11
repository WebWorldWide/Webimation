//! Webimation native engine. Every frame is a pure function of time: `render(scene, t, w, h)`.
//! Builds natively (parallel export, Tauri) and for wasm32 (live preview in the UI).

pub mod anim;
pub mod api;
pub mod cards;
pub mod dither;
pub mod field;
pub mod fonts;
pub mod frame;
pub mod glyph;
pub mod looks;
pub mod math;
pub mod palette;
pub mod pixel;
pub mod png;
pub mod render;
pub mod scene;
pub mod screen;
pub mod shapes;
pub mod text;
pub mod tone;
#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use frame::{Frame, Rgba};
pub use render::render;
pub use scene::Scene;

/// Render frames `[from, to)` of a scene at `fps` into `w × h`, in parallel on native builds,
/// calling `sink(index, frame)` in index order from one thread.
#[cfg(feature = "parallel")]
pub fn render_sequence<F: FnMut(u32, &Frame) -> Result<(), String>>(scene: &Scene, fps: u32, w: usize, h: usize, from: u32, to: u32, mut sink: F) -> Result<(), String> {
  use rayon::prelude::*;
  use std::sync::mpsc;
  let (tx, rx) = mpsc::sync_channel::<(u32, Frame)>(16);
  let scene2 = scene.clone();
  let worker = std::thread::spawn(move || {
    (from..to).into_par_iter().try_for_each_with(tx, |tx, i| { let f = render(&scene2, i as f32 / fps as f32, w, h); tx.send((i, f)).map_err(|_| ()) })
  });
  // Re-order on the consumer side: frames arrive out of order, the sink wants them in order.
  let mut pending = std::collections::BTreeMap::new();
  let mut next = from;
  for (i, f) in rx {
    pending.insert(i, f);
    while let Some(f) = pending.remove(&next) { sink(next, &f)?; next += 1; }
  }
  worker.join().map_err(|_| "render thread panicked".to_string())?.map_err(|_| "render cancelled".to_string())?;
  while let Some(f) = pending.remove(&next) { sink(next, &f)?; next += 1; }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn sequence_arrives_in_order_and_matches_single_renders() {
    let sc = looks::scene("shorts-hook").unwrap();
    let mut got = Vec::new();
    render_sequence(&sc, 12, 54, 96, 0, 24, |i, f| { got.push((i, f.px.clone())); Ok(()) }).unwrap();
    assert_eq!(got.len(), 24);
    for (n, (i, px)) in got.iter().enumerate() { assert_eq!(*i as usize, n); assert_eq!(px, &render(&sc, *i as f32 / 12.0, 54, 96).px); }
  }
}
