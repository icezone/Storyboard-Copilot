use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tracing::info;

use crate::ai::video::cache_manager::VideoCacheManager;
use crate::ai::video::providers::build_default_video_providers;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobStatus};
use crate::ai::video::VideoProviderRegistry;

static REGISTRY: std::sync::OnceLock<VideoProviderRegistry> = std::sync::OnceLock::new();
static CACHE_MANAGER: std::sync::OnceLock<Mutex<VideoCacheManager>> = std::sync::OnceLock::new();

fn get_registry() -> &'static VideoProviderRegistry {
    REGISTRY.get_or_init(|| {
        let mut registry = VideoProviderRegistry::new();
        for provider in build_default_video_providers() {
            registry.register_provider(provider);
        }
        registry
    })
}

async fn get_cache_manager(app: AppHandle) -> Result<&'static Mutex<VideoCacheManager>, String> {
    if let Some(manager) = CACHE_MANAGER.get() {
        return Ok(manager);
    }

    // Initialize cache manager
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("video_cache");

    let manager = VideoCacheManager::new(cache_dir)
        .await
        .map_err(|e| format!("Failed to initialize cache manager: {}", e))?;

    CACHE_MANAGER
        .set(Mutex::new(manager))
        .map_err(|_| "Failed to set cache manager")?;

    Ok(CACHE_MANAGER.get().unwrap())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoGenerateRequestDto {
    pub prompt: String,
    pub model: String,
    pub duration: Option<u32>,
    pub aspect_ratio: Option<String>,
    pub enable_audio: Option<bool>,
    pub seed: Option<i64>,
    pub start_frame_url: Option<String>,
    pub end_frame_url: Option<String>,
    pub extra_params: Option<HashMap<String, Value>>,
}

#[tauri::command]
pub async fn set_video_api_key(provider: String, api_key: String) -> Result<(), String> {
    info!("[VideoCommand] Setting API key for provider: {}", provider);

    let registry = get_registry();
    let resolved_provider = registry
        .get_provider(provider.as_str())
        .ok_or_else(|| format!("Unknown video provider: {}", provider))?;

    resolved_provider
        .set_api_key(api_key)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn generate_video(request: VideoGenerateRequestDto) -> Result<String, String> {
    info!("[VideoCommand] Generating video with model: {}", request.model);

    let registry = get_registry();
    let provider = registry
        .resolve_provider_for_model(&request.model)
        .or_else(|| registry.get_default_provider())
        .ok_or_else(|| "Video provider not found".to_string())?;

    let req = VideoGenerateRequest {
        prompt: request.prompt,
        model: request.model,
        duration: request.duration,
        aspect_ratio: request.aspect_ratio,
        enable_audio: request.enable_audio,
        seed: request.seed,
        start_frame_url: request.start_frame_url,
        end_frame_url: request.end_frame_url,
        extra_params: request.extra_params,
    };

    provider.generate(req).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn poll_video_job_status(job_id: String, model: String) -> Result<VideoJobStatus, String> {
    info!("[VideoCommand] Polling video job status: {}", job_id);

    let registry = get_registry();
    let provider = registry
        .resolve_provider_for_model(&model)
        .or_else(|| registry.get_default_provider())
        .ok_or_else(|| "Video provider not found".to_string())?;

    provider
        .get_status(&job_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_video_models() -> Result<Vec<String>, String> {
    Ok(get_registry().list_models())
}

#[tauri::command]
pub async fn cache_video(app: AppHandle, video_url: String, video_id: String) -> Result<String, String> {
    info!("[VideoCommand] Caching video: {}", video_id);

    let cache_manager_mutex = get_cache_manager(app).await?;
    let mut cache_manager = cache_manager_mutex.lock().await;

    let path = cache_manager
        .cache_video(&video_url, &video_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_cached_video_path(app: AppHandle, video_id: String) -> Result<Option<String>, String> {
    info!("[VideoCommand] Getting cached video path: {}", video_id);

    let cache_manager_mutex = get_cache_manager(app).await?;
    let mut cache_manager = cache_manager_mutex.lock().await;

    let path = cache_manager.get_cached_path(&video_id).await;
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn get_video_cache_stats(app: AppHandle) -> Result<crate::ai::video::types::CacheStats, String> {
    info!("[VideoCommand] Getting cache stats");

    let cache_manager_mutex = get_cache_manager(app).await?;
    let cache_manager = cache_manager_mutex.lock().await;

    Ok(cache_manager.get_stats())
}

#[tauri::command]
pub async fn clear_video_cache(app: AppHandle) -> Result<usize, String> {
    info!("[VideoCommand] Clearing video cache");

    let cache_manager_mutex = get_cache_manager(app).await?;
    let mut cache_manager = cache_manager_mutex.lock().await;

    cache_manager
        .clear_all()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_old_videos(app: AppHandle, max_age_days: u64) -> Result<usize, String> {
    info!("[VideoCommand] Cleaning up videos older than {} days", max_age_days);

    let cache_manager_mutex = get_cache_manager(app).await?;
    let mut cache_manager = cache_manager_mutex.lock().await;

    cache_manager
        .cleanup_old_videos(max_age_days)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_file_to_path(source_path: String, target_path: String) -> Result<(), String> {
    use std::path::PathBuf;

    // Normalize paths to handle mixed separators
    let source = PathBuf::from(&source_path);
    let target = PathBuf::from(&target_path);

    info!("[VideoCommand] Copying file from {:?} to {:?}", source, target);

    // Ensure target directory exists
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create target directory: {}", e))?;
    }

    std::fs::copy(&source, &target)
        .map_err(|e| format!("Failed to copy file: {}", e))?;

    info!("[VideoCommand] File copied successfully to {:?}", target);
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    info!("[VideoCommand] Revealing file in explorer: {}", path);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new("/")))
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
