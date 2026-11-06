// Frame export. The web side rasterises each frame to PNG and streams it here as a raw IPC body;
// this side owns every file write, then either keeps the PNG sequence or encodes it with ffmpeg.
use std::{
  collections::HashMap,
  fs,
  path::{Path, PathBuf},
  process::Command,
  sync::Mutex,
  time::{SystemTime, UNIX_EPOCH},
};

use tauri::{ipc::InvokeBody, ipc::Request, State};

#[derive(Default)]
pub struct Exports(Mutex<HashMap<String, PathBuf>>);

fn header<'a>(req: &'a Request<'_>, key: &str) -> Result<&'a str, String> {
  req
    .headers()
    .get(key)
    .and_then(|v| v.to_str().ok())
    .ok_or_else(|| format!("missing {key} header"))
}

/// Locate an ffmpeg-suite binary. GUI apps on macOS don't inherit the shell PATH, so also check the usual installs.
fn find_tool(name: &str) -> Option<PathBuf> {
  let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
  let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
  for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin", "C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin"] {
    dirs.push(PathBuf::from(d));
  }
  if let Some(home) = std::env::var_os("USERPROFILE") {
    dirs.push(Path::new(&home).join("scoop").join("shims"));
  }
  dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

fn ffmpeg() -> Option<PathBuf> {
  find_tool("ffmpeg")
}

/// Keep Windows from flashing a console window for each ffmpeg/ffprobe call.
fn quiet(cmd: &mut Command) -> &mut Command {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  cmd
}

/// The per-export temp folder. Removed on drop, so every exit path (gate failure, encoder failure,
/// cancelled or panicked job) cleans up without each one remembering to.
struct FrameDir(PathBuf);

impl Drop for FrameDir {
  fn drop(&mut self) {
    let _ = fs::remove_dir_all(&self.0);
  }
}

#[tauri::command]
pub fn ffmpeg_status() -> Option<String> {
  ffmpeg().map(|p| p.to_string_lossy().into_owned())
}

/// Start an export: a fresh temp folder that frames are written into.
#[tauri::command]
pub fn export_begin(state: State<'_, Exports>) -> Result<String, String> {
  let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
  let id = format!("w{nanos:x}");
  let dir = std::env::temp_dir().join("webimation-export").join(&id);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  state.0.lock().unwrap().insert(id.clone(), dir);
  Ok(id)
}

/// One PNG frame. Body: raw PNG bytes. Headers: x-export-id, x-index.
#[tauri::command]
pub fn export_frame(request: Request<'_>, state: State<'_, Exports>) -> Result<(), String> {
  let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw PNG body".into()) };
  let id = header(&request, "x-export-id")?;
  let index: u32 = header(&request, "x-index")?.parse().map_err(|_| "bad x-index")?;
  let dir = state.0.lock().unwrap().get(id).cloned().ok_or("unknown export")?;
  fs::write(dir.join(format!("frame_{index:05}.png")), bytes).map_err(|e| e.to_string())
}

/// Finish: `png` copies the sequence into `out` (a folder, files named `<stem>_00001.png`);
/// `prores`, `webm`, `mp4` encode with ffmpeg into the file `out`. The temp folder is always removed.
#[tauri::command]
pub async fn export_finish(id: String, format: String, fps: u32, out: String, stem: String, state: State<'_, Exports>) -> Result<String, String> {
  let dir = FrameDir(state.0.lock().unwrap().remove(&id).ok_or("unknown export")?);
  tauri::async_runtime::spawn_blocking(move || finish(&dir.0, &format, fps, Path::new(&out), &stem))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn export_cancel(id: String, state: State<'_, Exports>) {
  if let Some(dir) = state.0.lock().unwrap().remove(&id) {
    let _ = fs::remove_dir_all(dir);
  }
}

fn finish(dir: &Path, format: &str, fps: u32, out: &Path, stem: &str) -> Result<String, String> {
  let expected = verify_frames(dir)?;
  if format == "png" {
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let stem: String = stem.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let mut n = 0;
    let mut frames: Vec<_> = fs::read_dir(dir).map_err(|e| e.to_string())?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    frames.sort();
    for f in frames {
      n += 1;
      fs::copy(&f, out.join(format!("{stem}_{n:05}.png"))).map_err(|e| e.to_string())?;
    }
    return Ok(format!("{n} frames → {}", out.display()));
  }
  let ff = ffmpeg().ok_or("ffmpeg not found. Install it (brew install ffmpeg / winget install ffmpeg / apt install ffmpeg) or export a PNG sequence.")?;
  let input = dir.join("frame_%05d.png");
  let mut cmd = Command::new(ff);
  cmd.args(["-y", "-loglevel", "error", "-framerate", &fps.to_string(), "-start_number", "0", "-i"]).arg(&input);
  match format {
    // ProRes 4444 with a real alpha channel: the editor-standard overlay format.
    "prores" => cmd.args(["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0", "-qscale:v", "9"]),
    "webm" => cmd.args(["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "16", "-row-mt", "1", "-auto-alt-ref", "0"]),
    "mp4" => cmd.args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", "-preset", "slow", "-tune", "animation", "-movflags", "+faststart"]),
    other => return Err(format!("unknown format {other}")),
  };
  cmd.arg(out);
  let o = quiet(&mut cmd).output().map_err(|e| e.to_string())?;
  if !o.status.success() {
    let _ = fs::remove_file(out); // don't leave a truncated movie behind
    return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
  }
  verify_video(out, expected)?;
  Ok(format!("{}", out.display()))
}

/// Pre-encode gate: the folder must hold exactly frame_00000..frame_{N-1} with none empty. Returns N.
fn verify_frames(dir: &Path) -> Result<u32, String> {
  let mut indices: Vec<u32> = fs::read_dir(dir)
    .map_err(|e| e.to_string())?
    .filter_map(|e| e.ok())
    .filter_map(|e| frame_index(&e.file_name().to_string_lossy()))
    .collect();
  let n = check_contiguous(&mut indices)?;
  for i in 0..n {
    let len = fs::metadata(dir.join(format!("frame_{i:05}.png"))).map_err(|e| format!("frame {i} unreadable: {e}"))?.len();
    if len == 0 {
      return Err(format!("frame {i} is empty (0 bytes)"));
    }
  }
  Ok(n)
}

/// Frame index from a name written by `export_frame` (`frame_00042.png` -> 42).
fn frame_index(name: &str) -> Option<u32> {
  name.strip_prefix("frame_")?.strip_suffix(".png")?.parse().ok()
}

/// Pure contiguity check on the indices found on disk: they must be exactly 0..n. Returns n.
/// Reports the first missing index, which is also where the first gap starts.
fn check_contiguous(indices: &mut [u32]) -> Result<u32, String> {
  indices.sort_unstable();
  if indices.is_empty() {
    return Err("no frames were captured".into());
  }
  for (want, &got) in indices.iter().enumerate() {
    if got as usize != want {
      return Err(format!("frame {want} is missing (next frame on disk is {got})"));
    }
  }
  Ok(indices.len() as u32)
}

/// Post-encode gate for video output. Skipped silently when ffprobe isn't installed or can't run.
/// Clearly broken output (empty, unreadable, no video stream) is removed; a frame-count mismatch is
/// reported and the file is kept so it can be inspected.
fn verify_video(out: &Path, expected: u32) -> Result<(), String> {
  let Some(ffprobe) = find_tool("ffprobe") else { return Ok(()) };
  if fs::metadata(out).map(|m| m.len()).unwrap_or(0) == 0 {
    let _ = fs::remove_file(out);
    return Err(format!("export wrote an empty file: {}", out.display()));
  }
  let args = ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_packets", "-of", "json"];
  let Ok(o) = quiet(Command::new(&ffprobe).args(args).arg(out)).output() else { return Ok(()) };
  let probed = if o.status.success() {
    probed_frames(&String::from_utf8_lossy(&o.stdout))
  } else {
    Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
  };
  let got = probed.map_err(|e| {
    let _ = fs::remove_file(out);
    format!("export is unreadable: {e}")
  })?;
  if got.abs_diff(expected) > 1 {
    return Err(format!("frame count mismatch in {}: encoded {got} frames, expected {expected}", out.display()));
  }
  Ok(())
}

/// Video stream frame count from `ffprobe -count_packets -of json` output. One packet is one frame for
/// ProRes, VP9 and H.264 here, and counting packets is far cheaper than decoding.
fn probed_frames(json: &str) -> Result<u32, String> {
  let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
  let stream = v["streams"].get(0).ok_or("no video stream")?;
  stream["nb_read_packets"].as_str().and_then(|s| s.parse().ok()).ok_or_else(|| "no frame count in ffprobe output".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn probe(path: &Path) -> String {
    let o = Command::new("ffprobe")
      .args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,nb_read_frames:stream_tags=alpha_mode", "-count_frames", "-of", "csv=p=0"])
      .arg(path)
      .output()
      .unwrap();
    String::from_utf8_lossy(&o.stdout).trim().to_string()
  }

  #[test]
  fn encodes_every_format_with_alpha() {
    if ffmpeg().is_none() {
      eprintln!("ffmpeg not installed; skipping");
      return;
    }
    let base = std::env::temp_dir().join("webimation-export-test");
    let _ = fs::remove_dir_all(&base);
    let frames = base.join("frames");
    fs::create_dir_all(&frames).unwrap();
    // 12 RGBA frames: a moving opaque square on a fully transparent background.
    let ok = Command::new(ffmpeg().unwrap())
      .args(["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black@0.0:s=320x180:r=30,format=rgba", "-f", "lavfi", "-i", "color=c=orange:s=40x40:r=30",
        "-filter_complex", "[0][1]overlay=x=t*300:y=70:format=auto,format=rgba", "-frames:v", "12", "-start_number", "0"])
      .arg(frames.join("frame_%05d.png"))
      .status()
      .unwrap();
    assert!(ok.success());
    for (fmt, file, want) in [("prores", "a.mov", ["prores,320,180,yuva444p", ",12"]), ("webm", "a.webm", ["vp9,320,180,yuv420p,12", ",1"]), ("mp4", "a.mp4", ["h264,320,180,yuv420p,12", ""])] {
      let dir = base.join(fmt);
      copy_dir(&frames, &dir);
      let out = base.join(file);
      finish(&dir, fmt, 30, &out, "x").unwrap();
      let p = probe(&out);
      // prores: yuva pixel format (alpha); webm: alpha_mode=1 tag; mp4: no alpha by design.
      assert!(p.starts_with(want[0]) && p.ends_with(want[1]), "{fmt}: {p}");
    }
    let dir = base.join("png");
    copy_dir(&frames, &dir);
    let out = base.join("seq");
    assert!(finish(&dir, "png", 30, &out, "Lower third!").unwrap().starts_with("12 frames"));
    assert!(out.join("Lower-third-_00001.png").is_file() && out.join("Lower-third-_00012.png").is_file());
    let _ = fs::remove_dir_all(&base);
  }

  #[test]
  fn contiguity_gate_names_first_gap() {
    assert_eq!(check_contiguous(&mut [2, 0, 1]), Ok(3));
    assert_eq!(check_contiguous(&mut [0, 1, 3]).unwrap_err(), "frame 2 is missing (next frame on disk is 3)");
    assert_eq!(check_contiguous(&mut [1, 2]).unwrap_err(), "frame 0 is missing (next frame on disk is 1)");
    assert!(check_contiguous(&mut []).is_err());
    assert_eq!(frame_index("frame_00042.png"), Some(42));
    assert_eq!(frame_index("notes.txt"), None);
  }

  #[test]
  fn probe_output_is_parsed() {
    assert_eq!(probed_frames(r#"{"streams":[{"width":320,"height":180,"nb_read_packets":"12"}]}"#), Ok(12));
    assert_eq!(probed_frames(r#"{"streams":[]}"#).unwrap_err(), "no video stream");
    assert!(probed_frames(r#"{"streams":[{"width":320}]}"#).is_err());
  }

  #[test]
  fn frame_dir_is_removed_on_drop() {
    let dir = std::env::temp_dir().join(format!("webimation-framedir-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    drop(FrameDir(dir.clone()));
    assert!(!dir.exists());
  }

  fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
      let p = e.unwrap().path();
      fs::copy(&p, to.join(p.file_name().unwrap())).unwrap();
    }
  }
}
