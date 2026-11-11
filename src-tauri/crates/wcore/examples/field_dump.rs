fn main() {
  let id = std::env::args().nth(1).unwrap_or("horizon".into());
  let p = wcore::field::FieldParams { channel: serde_json::from_str(&format!("\"{id}\"")).unwrap(), ..Default::default() };
  let (cols, rows) = (100, 28);
  let ramp: Vec<char> = " .:-=+*#%@".chars().collect();
  for y in 0..rows { let mut s = String::new(); for x in 0..cols { let v = p.sample((x as f32 + 0.5) / cols as f32, (y as f32 + 0.5) / rows as f32, 16.0 / 9.0, 1.0); s.push(ramp[((v * 9.0).round() as usize).min(9)]); } println!("{s}"); }
}
