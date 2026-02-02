use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::process::CommandChild;

struct DownloadState(Arc<Mutex<HashMap<String, CommandChild>>>);

#[derive(Clone, Serialize)]
struct DownloadProgress {
    id: String,
    message: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

async fn resolve_redirect(url: &str) -> String {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap_or_default();
    
    // Use GET instead of HEAD as some servers return different headers/behavior for HEAD
    match client.get(url).send().await {
        Ok(resp) => {
            let status = resp.status();
            println!("Redirect status: {}", status);
            let final_url = resp.url().to_string();
            if status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                let haystack = &text;
                let patterns = vec![
                    "\"videoId\":\"",     // Standard
                    "\\\"videoId\\\":\\\"" // Escaped
                ];

                for pattern in patterns {
                    let mut start_search = 0;
                    while let Some(pos) = haystack[start_search..].find(pattern) {
                        let val_start = start_search + pos + pattern.len();
                        if val_start + 11 <= haystack.len() {
                            let potential_id = &haystack[val_start..val_start+11];
                             // Basic validation: ID should not contain quotes or backslashes
                            if !potential_id.contains('"') && !potential_id.contains('\\') {
                                println!("Found potential videoId: {}", potential_id);
                                if !url.contains(potential_id) {
                                    println!("Redirecting to new ID: {}", potential_id);
                                    return format!("https://music.youtube.com/watch?v={}", potential_id);
                                }
                            }
                        }
                        start_search = val_start;
                    }
                }
                
                if let Some(start) = text.find("link rel=\"canonical\" href=\"") {
                    let rest = &text[start + 27..];
                    if let Some(end) = rest.find('"') {
                         let canonical_url = &rest[..end];
                         println!("Found canonical URL: {}", canonical_url);
                         return canonical_url.to_string();
                    }
                }
            }


            final_url
        },
        Err(e) => {
            println!("Redirect error: {}", e);
            url.to_string() 
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub id: String,
    pub title: String,
    pub url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<u64>,
}

#[tauri::command]
async fn analyze_playlist(app: tauri::AppHandle, url: String) -> Result<Vec<VideoMetadata>, String> {
    let output = app.shell().sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(["--flat-playlist", "--dump-single-json", "--js-runtimes", "node", &url])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // println!("yt-dlp stdout: {}", stdout);
    // Parse the JSON output. yt-dlp returns a single JSON object for a playlist
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    let mut results = Vec::new();

    if let Some(entries) = json.get("entries").and_then(|e| e.as_array()) {
         for entry in entries {
            let id = entry["id"].as_str().unwrap_or_default().to_string();
            let title = entry["title"].as_str().unwrap_or_default().to_string();
            let entry_url = entry["url"].as_str().unwrap_or_default().to_string();
            let duration = entry.get("duration").and_then(|s| s.as_u64());
            // flat-playlist might not have thumbnails/duration for all entries, but we try
            let thumbnail = entry.get("thumbnails")
                 .and_then(|t| t.as_array())
                 .and_then(|t| t.first())
                 .and_then(|t| t["url"].as_str())
                 .map(|s| s.to_string());
            
             // Construct full URL if it's just an ID (yt-dlp sometimes gives just ID)
             // We check the input playlist URL to see if we should use the music domain
             let full_url = if url.contains("music.youtube.com") {
                 entry_url
             } else if entry_url.starts_with("http") { 
                 entry_url 
             } else { 
                 format!("https://www.youtube.com/watch?v={}", id) 
             };

            results.push(VideoMetadata {
                id,
                title,
                url: full_url,
                thumbnail,
                duration: duration
            });
         }
    } else {
        // Single video case
        let id = json["id"].as_str().unwrap_or_default().to_string();
        let title = json["title"].as_str().unwrap_or_default().to_string();
        let webpage_url = json["webpage_url"].as_str().unwrap_or(url.as_str()).to_string();
        let thumbnail = json.get("thumbnail").and_then(|s| s.as_str()).map(|s| s.to_string());
        let duration = json.get("duration").and_then(|s| s.as_u64());

        results.push(VideoMetadata {
            id,
            title,
            url: webpage_url,
            thumbnail,
            duration: duration
        });
    }

    Ok(results)
}

#[tauri::command]
async fn stop_download(state: State<'_, DownloadState>, id: String) -> Result<(), String> {
    println!("Stopping download for id: {}", id);
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    
    if let Some(child) = map.remove(&id) {
         child.kill().map_err(|e| e.to_string())?;
         Ok(())
    } else {
        // It might have already finished or not exist
        Ok(())
    }
}

#[tauri::command]
async fn download_video(
    app: tauri::AppHandle, 
    state: State<'_, DownloadState>,
    id: String, 
    url: String, 
    format: String, 
    download_dir: Option<String>
) -> Result<String, String> {
    // Resolve the target directory: Use provided one or fallback to default Downloads
    let target_dir = if let Some(dir) = download_dir {
        std::path::PathBuf::from(dir)
    } else {
        app.path().download_dir().map_err(|e| e.to_string())?
    };
    
    // Construct the template: /path/to/downloads/%(title)s.%(ext)s
    let template = target_dir.join("%(title)s.%(ext)s");
    let template_str = template.to_string_lossy().to_string();

    // Resolve the resource path for ffmpeg.exe
    // We assume it's in the resource directory under "binaries/ffmpeg.exe"
    let resource_path = app.path().resolve("binaries/ffmpeg.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    
    let ffmpeg_location = resource_path.to_string_lossy().to_string();

    let effective_url = if url.contains("music.youtube.com") {
        let resolved = resolve_redirect(&url).await;
        println!("Resolving URL: {} -> {}", url, resolved);
        resolved
    } else {
        url.clone()
    };

    let mut args = vec![
        "-o".to_string(),
        template_str,
        "--js-runtimes".to_string(),
        "node".to_string(),
        "--ffmpeg-location".to_string(),
        ffmpeg_location,
        "-N".to_string(), 
        "8".to_string(),
        "-w".to_string(), // Do not overwrite existing files
        effective_url.clone(),
    ];

    if format == "mp3" {
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push("mp3".to_string());
        args.push("--audio-quality".to_string());
        args.push("320K".to_string());
    } else if format == "mp4" {
        args.push("--merge-output-format".to_string());
        args.push("mp4".to_string());
        // Force audio codec to mp3 using ffmpeg
        args.push("--postprocessor-args".to_string());
        args.push("ffmpeg:-c:v copy -c:a libmp3lame".to_string());
    }
    
    // We can use spawn to track progress
    let (mut rx, child) = app.shell().sidecar("yt-dlp")
         .map_err(|e| e.to_string())?
         .args(args)
         .spawn()
         .map_err(|e| e.to_string())?;

    // Store child process to allow cancellation
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        map.insert(id.clone(), child);
    }

    
    // Instead of spawning a detached task, we await the events loop here
    let mut download_result = Ok("Download completed".to_string());

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(line) => {
                 let line_str = String::from_utf8_lossy(&line);
                 // Emit progress event with ID
                 let progress = DownloadProgress {
                    id: id.clone(),
                    message: line_str.to_string(),
                 };
                 let _ = app.emit("download-progress", progress);
            }
            CommandEvent::Stderr(line) => {
                let line_str = String::from_utf8_lossy(&line);
                println!("yt-dlp stderr: {}", line_str);
            }
            CommandEvent::Terminated(payload) => {
                if let Some(code) = payload.code {
                    if code != 0 {
                        // If it was killed (e.g. via stop_download), code might be non-zero (often 1 or SIGTERM etc)
                        // But for now we just treat non-zero as error unless we find a way to distinguish manual kill
                        download_result = Err(format!("yt-dlp exited with error code: {}", code));
                    }
                    break;
                }
            }
            _ => {}
        }
    }
    
    // Cleanup from map if it's still there
    {
        let mut map = state.0.lock().map_err(|_e| "Failed to lock state".to_string())?;
        map.remove(&id);
    }
    
    download_result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState(Arc::new(Mutex::new(HashMap::new()))))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet, analyze_playlist, download_video, stop_download])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
