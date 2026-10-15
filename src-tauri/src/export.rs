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

/// Locate ffmpeg. GUI apps on macOS don't inherit the shell PATH, so also check the usual installs.
fn ffmpeg() -> Option<PathBuf> {
  let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
  let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
  for d in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin", "C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin"] {
    dirs.push(PathBuf::from(d));
  }
  if let Some(home) = std::env::var_os("USERPROFILE") {
    dirs.push(Path::new(&home).join("scoop").join("shims"));
  }
  dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
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
  let dir = state.0.lock().unwrap().remove(&id).ok_or("unknown export")?;
  tauri::async_runtime::spawn_blocking(move || {
    let r = finish(&dir, &format, fps, Path::new(&out), &stem);
    let _ = fs::remove_dir_all(&dir);
    r
  })
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
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  let o = cmd.output().map_err(|e| e.to_string())?;
  if !o.status.success() {
    return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
  }
  Ok(format!("{}", out.display()))
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

  fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
      let p = e.unwrap().path();
      fs::copy(&p, to.join(p.file_name().unwrap())).unwrap();
    }
  }
}
