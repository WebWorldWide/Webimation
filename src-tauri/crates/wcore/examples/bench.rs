//! cargo run --release --example bench  — frames per second for each starter scene at 1080p.
use std::time::Instant;
fn main() {
  wcore::fonts::load_dir(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"));
  for (id, _, _) in wcore::looks::SCENES {
    let sc = wcore::looks::scene(id).unwrap();
    let (w, h) = if sc.w > sc.h { (1920, 1080) } else { (1080, 1920) };
    let n = 60;
    let t0 = Instant::now();
    let mut px = 0usize;
    wcore::render_sequence(&sc, 30, w, h, 0, n, |_, f| { px += f.px[0] as usize; Ok(()) }).unwrap();
    let par = n as f64 / t0.elapsed().as_secs_f64();
    let t1 = Instant::now();
    for i in 0..10 { let f = wcore::render(&sc, i as f32 / 30.0 + 1.0, w, h); px += f.px[1] as usize; }
    let single = 10.0 / t1.elapsed().as_secs_f64();
    println!("{id:<14} {par:7.1} fps all cores   {single:6.1} fps one core   ({px})");
  }
}
