// Native bounce: the scene is rendered here by the Rust engine (all cores), and raw RGBA frames
// are piped straight into ffmpeg. No PNG round-trip, no webview in the loop.
use std::{
  collections::HashMap,
  fs,
  io::Write,
  path::{Path, PathBuf},
  process::{Command, Stdio},
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
  },
  time::Instant,
};

use rayon::prelude::*;
use serde::Serialize;
use tauri::{ipc::InvokeBody, ipc::Request, AppHandle, Emitter, Manager, State};
use wcore::Scene;

use crate::export::{ffmpeg, quiet, verify_video};

#[derive(Default)]
pub struct Bounces(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Clone, Serialize)]
struct Progress<'a> {
  job: &'a str,
  done: u32,
  total: u32,
  fps: f32,
}

/// Load the bundled fonts into the engine. Resource folder first (installed app), then the source
/// tree (dev builds).
pub fn load_fonts(app: &AppHandle) -> usize {
  let mut dirs: Vec<PathBuf> = Vec::new();
  if let Ok(r) = app.path().resource_dir() {
    dirs.push(r.join("fonts"));
  }
  dirs.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("crates/wcore/fonts"));
  dirs.iter().map(|d| wcore::fonts::load_dir(d)).find(|&n| n > 0).unwrap_or(0)
}

#[tauri::command]
pub fn engine_info() -> serde_json::Value {
  serde_json::json!({ "fonts": wcore::fonts::loaded_fonts().len(), "threads": rayon::current_num_threads(), "hevcAlpha": cfg!(target_os = "macos") })
}

#[tauri::command]
pub fn bounce_cancel(job: String, state: State<'_, Bounces>) {
  if let Some(f) = state.0.lock().unwrap().get(&job) {
    f.store(true, Ordering::Relaxed);
  }
}

/// Render `scene` to `out`. Formats: `prores` (.mov, alpha), `hevc` (.mov, alpha, macOS),
/// `webm` (VP9 alpha), `mp4` (H.264, no alpha), `png` (folder of numbered PNGs).
/// `from`/`to` are frame numbers at `fps` (to = 0 means the scene's end).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn bounce(app: AppHandle, state: State<'_, Bounces>, job: String, scene: String, fps: u32, width: u32, height: u32, format: String, out: String, from: Option<u32>, to: Option<u32>) -> Result<String, String> {
  let scene = Scene::from_json(&scene)?;
  let cancel = Arc::new(AtomicBool::new(false));
  state.0.lock().unwrap().insert(job.clone(), cancel.clone());
  let job2 = job.clone();
  let res = tauri::async_runtime::spawn_blocking(move || {
    let total_frames = scene.frames(fps.max(1));
    let from = from.unwrap_or(0).min(total_frames);
    let to = match to { Some(t) if t > from => t.min(total_frames), _ => total_frames };
    let progress = |done: u32, started: Instant| {
      let secs = started.elapsed().as_secs_f32().max(1e-3);
      let _ = app.emit("bounce-progress", Progress { job: &job2, done, total: to - from, fps: done as f32 / secs });
    };
    run(&scene, fps.max(1), width as usize, height as usize, &format, Path::new(&out), from, to, &cancel, progress)
  })
  .await
  .map_err(|e| e.to_string())?;
  state.0.lock().unwrap().remove(&job);
  res
}

#[allow(clippy::too_many_arguments)]
pub fn run(scene: &Scene, fps: u32, w: usize, h: usize, format: &str, out: &Path, from: u32, to: u32, cancel: &AtomicBool, progress: impl Fn(u32, Instant) + Sync) -> Result<String, String> {
  let started = Instant::now();
  let n = to - from;
  if format == "png" {
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let stem = out.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "frame".into());
    let done = std::sync::atomic::AtomicU32::new(0);
    (from..to).into_par_iter().try_for_each(|i| {
      if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
      }
      let f = wcore::render(scene, i as f32 / fps as f32, w, h);
      fs::write(out.join(format!("{stem}_{:05}.png", i - from + 1)), wcore::png::encode(&f)).map_err(|e| e.to_string())?;
      let d = done.fetch_add(1, Ordering::Relaxed) + 1;
      if d % 4 == 0 || d == n {
        progress(d, started);
      }
      Ok(())
    })?;
    return Ok(format!("{n} frames → {}", out.display()));
  }
  let ff = ffmpeg().ok_or("ffmpeg not found. Install it (brew install ffmpeg / winget install ffmpeg / apt install ffmpeg) or choose PNG images.")?;
  if let Some(dir) = out.parent() {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  let mut cmd = Command::new(ff);
  cmd.args(["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", &format!("{w}x{h}"), "-r", &fps.to_string(), "-i", "-"]);
  match format {
    "prores" => cmd.args(["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0", "-qscale:v", "9"]),
    "hevc" => cmd.args(["-c:v", "hevc_videotoolbox", "-alpha_quality", "0.9", "-q:v", "70", "-tag:v", "hvc1", "-pix_fmt", "bgra"]),
    "webm" => cmd.args(["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "16", "-row-mt", "1", "-auto-alt-ref", "0"]),
    "mp4" => cmd.args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", "-preset", "medium", "-tune", "animation", "-movflags", "+faststart"]),
    other => return Err(format!("unknown format {other}")),
  };
  cmd.arg(out).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
  let mut child = quiet(&mut cmd).spawn().map_err(|e| e.to_string())?;
  let mut stdin = child.stdin.take().ok_or("ffmpeg has no stdin")?;
  let piped = wcore::render_sequence(scene, fps, w, h, from, to, |i, f| {
    if cancel.load(Ordering::Relaxed) {
      return Err("cancelled".into());
    }
    stdin.write_all(&f.px).map_err(|e| format!("ffmpeg stopped reading: {e}"))?;
    let d = i - from + 1;
    if d % 4 == 0 || d == n {
      progress(d, started);
    }
    Ok(())
  });
  drop(stdin);
  let o = child.wait_with_output().map_err(|e| e.to_string())?;
  if let Err(e) = piped {
    let _ = fs::remove_file(out);
    let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
    return Err(if err.is_empty() { e } else { format!("{e}: {err}") });
  }
  if !o.status.success() {
    let _ = fs::remove_file(out);
    return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
  }
  verify_video(out, n)?;
  Ok(out.display().to_string())
}

/// Write a text file (timeline XML, README) next to bounced clips.
#[tauri::command]
pub fn write_text(path: String, text: String) -> Result<(), String> {
  if let Some(d) = Path::new(&path).parent() {
    fs::create_dir_all(d).map_err(|e| e.to_string())?;
  }
  fs::write(path, text).map_err(|e| e.to_string())
}

/// Write raw bytes (drag icons, sprite sheets). Body: the bytes. Header x-path: destination.
#[tauri::command]
pub fn write_file(request: Request<'_>) -> Result<(), String> {
  let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw body".into()) };
  let path = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("missing x-path header")?;
  let path = percent_decode(path);
  if let Some(d) = Path::new(&path).parent() {
    fs::create_dir_all(d).map_err(|e| e.to_string())?;
  }
  fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Headers must be ASCII, so the UI percent-encodes paths.
fn percent_decode(s: &str) -> String {
  let b = s.as_bytes();
  let mut out = Vec::with_capacity(b.len());
  let mut i = 0;
  while i < b.len() {
    if b[i] == b'%' && i + 2 < b.len() + 0 && i + 2 <= b.len() - 1 {
      if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
        out.push(v);
        i += 3;
        continue;
      }
    }
    out.push(b[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

/// The user's Movies (macOS) / Videos folder + "Webimation", for one-click exports.
#[tauri::command]
pub fn default_out_dir(app: AppHandle) -> Result<String, String> {
  let base = app.path().video_dir().or_else(|_| app.path().home_dir()).map_err(|e| e.to_string())?;
  Ok(base.join("Webimation").display().to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn percent_decoding() {
    assert_eq!(percent_decode("/a%20b/Name%20tag%20%E2%80%93.png"), "/a b/Name tag –.png");
    assert_eq!(percent_decode("plain%"), "plain%");
  }

  #[test]
  fn bounces_every_format_natively() {
    if ffmpeg().is_none() {
      eprintln!("ffmpeg not installed; skipping");
      return;
    }
    wcore::fonts::load_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("crates/wcore/fonts"));
    let scene = wcore::looks::scene("channel-intro").unwrap();
    let base = std::env::temp_dir().join(format!("webimation-bounce-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let never = AtomicBool::new(false);
    let mut formats = vec![("prores", "a.mov"), ("webm", "a.webm"), ("mp4", "a.mp4")];
    if cfg!(target_os = "macos") {
      formats.push(("hevc", "b.mov"));
    }
    for (fmt, file) in formats {
      let out = base.join(file);
      run(&scene, 12, 320, 180, fmt, &out, 0, 24, &never, |_, _| {}).unwrap_or_else(|e| panic!("{fmt}: {e}"));
      assert!(fs::metadata(&out).unwrap().len() > 1000, "{fmt}");
    }
    let png = base.join("seq");
    assert!(run(&scene, 12, 320, 180, "png", &png, 0, 12, &never, |_, _| {}).unwrap().starts_with("12 frames"));
    assert!(png.join("seq_00001.png").is_file() && png.join("seq_00012.png").is_file());
    let stop = AtomicBool::new(true);
    assert!(run(&scene, 12, 320, 180, "prores", &base.join("c.mov"), 0, 24, &stop, |_, _| {}).is_err());
    assert!(!base.join("c.mov").exists());
    let _ = fs::remove_dir_all(&base);
  }
}
