//! JSON API shared by the wasm host and the Tauri commands: the catalogue (effects, cards, fonts,
//! palettes, charsets, channels, shapes, starters) and helpers that build scenes.

use serde_json::{json, Value};
use crate::scene::Scene;

pub fn catalogue() -> Value {
  json!({
    "effects": crate::anim::EFFECTS,
    "cards": crate::cards::CARDS,
    "colorSets": crate::cards::COLOR_SETS.iter().map(|c| json!({"id": c.id, "plate": c.plate, "onPlate": c.on_plate, "accent": c.accent, "ink": c.ink, "paper": c.paper})).collect::<Vec<_>>(),
    "fonts": crate::fonts::FONTS,
    "palettes": crate::palette::palettes(),
    "charsets": crate::glyph::CHARSETS.iter().map(|c| json!({"id": c.0, "name": c.1, "chars": c.2})).collect::<Vec<_>>(),
    "channels": crate::field::Channel::ALL.iter().map(|c| { let (n, b) = c.label(); json!({"id": serde_json::to_value(c).unwrap(), "name": n, "blurb": b}) }).collect::<Vec<_>>(),
    "dithers": crate::dither::DitherKind::ALL.iter().map(|d| json!({"id": serde_json::to_value(d).unwrap(), "name": d.label()})).collect::<Vec<_>>(),
    "shapes": crate::shapes::ShapeKind::ALL.iter().map(|s| json!({"id": serde_json::to_value(s).unwrap(), "name": s.label(), "open": s.is_open()})).collect::<Vec<_>>(),
    "starters": crate::pixel::STARTERS.iter().map(|s| json!({"id": s.0, "name": s.1, "note": s.2, "sprite": crate::pixel::starter(s.0)})).collect::<Vec<_>>(),
    "looks": crate::looks::LOOKS.iter().map(|l| json!({"id": l.id, "name": l.name, "style": l.style, "field": l.field, "screen": l.screen})).collect::<Vec<_>>(),
    "scenes": crate::looks::SCENES.iter().map(|s| json!({"id": s.0, "name": s.1, "blurb": s.2})).collect::<Vec<_>>(),
  })
}

/// Handle a query: `{"op": "catalogue"}`, `{"op": "scene", "id": "channel-intro"}`,
/// `{"op": "ascii", "sprite": {...}, "frame": 0, "ramp": " .#"}`, `{"op": "frameText", "scene": {...}, "t": 1.0, "cols": 80}`.
pub fn query(req: &str) -> String {
  let v: Value = match serde_json::from_str(req) { Ok(v) => v, Err(e) => return json!({"error": e.to_string()}).to_string() };
  let op = v["op"].as_str().unwrap_or("");
  let out = match op {
    "catalogue" => catalogue(),
    "scene" => crate::looks::scene(v["id"].as_str().unwrap_or("")).map(|s| serde_json::to_value(s).unwrap()).unwrap_or(json!({"error": "unknown scene"})),
    "ascii" => match serde_json::from_value::<crate::pixel::Sprite>(v["sprite"].clone()) { Ok(sp) => json!({"text": sp.to_ascii(v["frame"].as_u64().unwrap_or(0) as usize, v["ramp"].as_str().unwrap_or(" .:-=+*#%@"))}), Err(e) => json!({"error": e.to_string()}) },
    "frameText" => match serde_json::from_value::<Scene>(v["scene"].clone()) {
      Ok(scene) => { let cols = v["cols"].as_u64().unwrap_or(120) as usize; let rows = (cols as f32 / scene.aspect() / 2.0).round().max(1.0) as usize; let f = crate::render::render(&scene, v["t"].as_f64().unwrap_or(0.0) as f32, cols * 2, rows * 4); let g = crate::glyph::frame_to_cells(&f, cols, rows); let ramp: Vec<char> = v["ramp"].as_str().unwrap_or(" .:-=+*#%@").chars().collect(); let mut s = String::new(); for y in 0..rows { for x in 0..cols { let i = ((g[y * cols + x] * (ramp.len() - 1) as f32).round() as usize).min(ramp.len() - 1); s.push(ramp[i]); } s.push('\n'); } json!({"text": s}) }
      Err(e) => json!({"error": e.to_string()}),
    },
    "histogram" => match serde_json::from_value::<Scene>(v["scene"].clone()) {
      Ok(scene) => { let f = crate::render::render(&scene, v["t"].as_f64().unwrap_or(0.0) as f32, 192, 108); let g = crate::glyph::frame_to_cells(&f, 96, 54); json!({"bins": crate::tone::Tone::histogram(&g)}) }
      Err(e) => json!({"error": e.to_string()}),
    },
    "fonts" => json!({"loaded": crate::fonts::loaded_fonts()}),
    "bounds" => match serde_json::from_value::<Scene>(v["scene"].clone()) {
      Ok(scene) => json!(crate::render::bounds(&scene).into_iter().map(|(id, b)| (id, b)).collect::<std::collections::BTreeMap<_, _>>()),
      Err(e) => json!({"error": e.to_string()}),
    },
    "coverage" => match serde_json::from_value::<Scene>(v["scene"].clone()) {
      Ok(scene) => json!(crate::render::coverage(&scene, v["t"].as_f64().unwrap_or(0.0) as f32).into_iter().collect::<std::collections::BTreeMap<_, _>>()),
      Err(e) => json!({"error": e.to_string()}),
    },
    "inkOrder" => { let font = v["font"].as_str().unwrap_or("jetbrains-mono"); let chars: String = v["chars"].as_str().unwrap_or("").into(); let st = crate::glyph::GlyphStyle { font: font.into(), chars, sort_by_ink: true, ..Default::default() }; json!({"chars": st.ramp().into_iter().collect::<String>(), "ink": st.ramp().iter().map(|c| crate::glyph::ink_of(font, *c)).collect::<Vec<_>>()}) }
    "grid" => match serde_json::from_value::<crate::glyph::GlyphStyle>(v["style"].clone()) { Ok(st) => { let (c, r, cw, ch) = st.grid(v["w"].as_u64().unwrap_or(1920) as usize, v["h"].as_u64().unwrap_or(1080) as usize); json!({"cols": c, "rows": r, "cw": cw, "ch": ch}) } Err(e) => json!({"error": e.to_string()}) },
    _ => json!({"error": format!("unknown op {op}")}),
  };
  out.to_string()
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn catalogue_and_queries_answer() {
    let c = catalogue();
    assert!(c["effects"].as_array().unwrap().len() > 60);
    assert!(c["cards"].as_array().unwrap().len() >= 20);
    assert!(c["fonts"].as_array().unwrap().len() >= 30);
    let r = query(r#"{"op":"scene","id":"channel-intro"}"#);
    assert!(r.contains("\"objects\""), "{r}");
    assert!(query("nope").contains("error"));
  }
}
