use std::time::Instant;
fn main() {
  wcore::fonts::load_dir(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fonts"));
  let base = wcore::looks::scene("ascii-drop").unwrap();
  let time = |s: &wcore::Scene, label: &str| { let t = Instant::now(); for i in 0..10 { wcore::render(s, 1.0 + i as f32 / 30.0, 1920, 1080); } println!("{label:<20} {:.1} ms/frame", t.elapsed().as_secs_f64() * 100.0); };
  time(&base, "full");
  let mut a = base.clone(); a.screen = Default::default(); time(&a, "no screen fx");
  let mut b = base.clone(); b.screen.glow = 0.0; time(&b, "no glow");
  let mut c = a.clone(); c.objects.truncate(1); time(&c, "field only");
  let mut d = a.clone(); d.objects.remove(0); time(&d, "title only");
}
