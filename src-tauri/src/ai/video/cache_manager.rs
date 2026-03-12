use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

use super::error::VideoError;
use super::types::CacheStats;

const MAX_CACHE_SIZE_BYTES: u64 = 5 * 1024 * 1024 * 1024; // 5GB
const MAX_CACHE_AGE_DAYS: u64 = 30;
const METADATA_FILE_NAME: &str = "cache_metadata.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoCacheEntry {
    pub video_path: String,
    pub size_bytes: u64,
    pub cached_at: u64,
    pub last_accessed: u64,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CacheMetadata {
    pub entries: HashMap<String, VideoCacheEntry>,
}

pub struct VideoCacheManager {
    cache_dir: PathBuf,
    metadata: CacheMetadata,
    client: Client,
}

impl VideoCacheManager {
    /// Creates a new cache manager
    pub async fn new(cache_dir: PathBuf) -> Result<Self, VideoError> {
        // Ensure cache directory exists
        fs::create_dir_all(&cache_dir).await?;

        // Load metadata
        let metadata = Self::load_metadata(&cache_dir).await.unwrap_or_default();

        Ok(Self {
            cache_dir,
            metadata,
            client: Client::new(),
        })
    }

    /// Loads metadata from disk
    async fn load_metadata(cache_dir: &Path) -> Result<CacheMetadata, VideoError> {
        let metadata_path = cache_dir.join(METADATA_FILE_NAME);

        if !metadata_path.exists() {
            return Ok(CacheMetadata::default());
        }

        let content = fs::read_to_string(&metadata_path).await?;
        let metadata: CacheMetadata = serde_json::from_str(&content)?;
        Ok(metadata)
    }

    /// Saves metadata to disk
    async fn save_metadata(&self) -> Result<(), VideoError> {
        let metadata_path = self.cache_dir.join(METADATA_FILE_NAME);
        let content = serde_json::to_string_pretty(&self.metadata)?;
        fs::write(&metadata_path, content).await?;
        Ok(())
    }

    /// Gets current timestamp in seconds
    fn current_timestamp() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    /// Caches a video from a URL
    pub async fn cache_video(&mut self, video_url: &str, video_id: &str) -> Result<PathBuf, VideoError> {
        info!("[VideoCacheManager] Caching video: {}", video_id);

        // Download the video
        let response = self.client.get(video_url).send().await?;

        if !response.status().is_success() {
            return Err(VideoError::Cache(format!(
                "Failed to download video: HTTP {}",
                response.status()
            )));
        }

        let video_bytes = response.bytes().await?;
        let size_bytes = video_bytes.len() as u64;

        // Determine file extension from URL or default to .mp4
        let extension = video_url
            .split('?')
            .next()
            .and_then(|path| path.rsplit('.').next())
            .filter(|ext| matches!(ext.to_lowercase().as_str(), "mp4" | "mov" | "avi" | "webm"))
            .unwrap_or("mp4");

        let filename = format!("{}.{}", video_id, extension);
        let video_path = self.cache_dir.join(&filename);

        // Write video to disk
        let mut file = fs::File::create(&video_path).await?;
        file.write_all(&video_bytes).await?;
        file.flush().await?;

        info!("[VideoCacheManager] Video cached: {} ({} bytes)", filename, size_bytes);

        // Update metadata
        let now = Self::current_timestamp();
        let entry = VideoCacheEntry {
            video_path: video_path.to_string_lossy().to_string(),
            size_bytes,
            cached_at: now,
            last_accessed: now,
            source_url: video_url.to_string(),
        };

        self.metadata.entries.insert(video_id.to_string(), entry);
        self.save_metadata().await?;

        // Cleanup if needed
        self.cleanup_if_needed().await?;

        Ok(video_path)
    }

    /// Gets cached video path and updates last_accessed
    pub async fn get_cached_path(&mut self, video_id: &str) -> Option<PathBuf> {
        if let Some(entry) = self.metadata.entries.get_mut(video_id) {
            let path = PathBuf::from(&entry.video_path);

            // Verify file still exists
            if path.exists() {
                entry.last_accessed = Self::current_timestamp();
                let _ = self.save_metadata().await;
                return Some(path);
            } else {
                warn!("[VideoCacheManager] Cached file missing: {}", video_id);
                // Remove stale entry
                self.metadata.entries.remove(video_id);
                let _ = self.save_metadata().await;
            }
        }

        None
    }

    /// Cleans up cache using LRU eviction
    pub async fn cleanup_if_needed(&mut self) -> Result<(), VideoError> {
        let total_size: u64 = self.metadata.entries.values().map(|e| e.size_bytes).sum();

        if total_size <= MAX_CACHE_SIZE_BYTES {
            return Ok(());
        }

        info!("[VideoCacheManager] Cache size {} exceeds limit {}, starting cleanup",
            total_size, MAX_CACHE_SIZE_BYTES);

        // Sort entries by last_accessed (LRU) and collect IDs to remove
        let mut entries: Vec<_> = self.metadata.entries.iter()
            .map(|(id, entry)| (id.clone(), entry.video_path.clone(), entry.size_bytes, entry.last_accessed))
            .collect();
        entries.sort_by_key(|(_, _, _, last_accessed)| *last_accessed);

        let mut current_size = total_size;
        let target_size = (MAX_CACHE_SIZE_BYTES as f64 * 0.8) as u64; // Clean to 80% capacity

        let mut videos_to_remove = Vec::new();

        for (video_id, video_path, size_bytes, _) in entries {
            if current_size <= target_size {
                break;
            }

            info!("[VideoCacheManager] Evicting video: {}", video_id);

            // Delete file
            let path = PathBuf::from(&video_path);
            if path.exists() {
                if let Err(e) = fs::remove_file(&path).await {
                    warn!("[VideoCacheManager] Failed to delete {}: {}", video_id, e);
                }
            }

            current_size -= size_bytes;
            videos_to_remove.push(video_id);
        }

        // Remove entries from metadata
        for video_id in videos_to_remove {
            self.metadata.entries.remove(&video_id);
        }

        self.save_metadata().await?;
        info!("[VideoCacheManager] Cleanup complete, new size: {}", current_size);

        Ok(())
    }

    /// Removes videos older than the specified age
    pub async fn cleanup_old_videos(&mut self, max_age_days: u64) -> Result<usize, VideoError> {
        let now = Self::current_timestamp();
        let max_age_seconds = max_age_days * 24 * 60 * 60;
        let mut removed_count = 0;

        let old_videos: Vec<String> = self
            .metadata
            .entries
            .iter()
            .filter(|(_, entry)| {
                now.saturating_sub(entry.cached_at) > max_age_seconds
            })
            .map(|(id, _)| id.clone())
            .collect();

        for video_id in old_videos {
            if let Some(entry) = self.metadata.entries.remove(&video_id) {
                let path = PathBuf::from(&entry.video_path);
                if path.exists() {
                    if let Err(e) = fs::remove_file(&path).await {
                        warn!("[VideoCacheManager] Failed to delete old video {}: {}", video_id, e);
                    } else {
                        removed_count += 1;
                    }
                }
            }
        }

        if removed_count > 0 {
            self.save_metadata().await?;
            info!("[VideoCacheManager] Removed {} old videos", removed_count);
        }

        Ok(removed_count)
    }

    /// Gets cache statistics
    pub fn get_stats(&self) -> CacheStats {
        let total_videos = self.metadata.entries.len();
        let total_size_bytes: u64 = self.metadata.entries.values().map(|e| e.size_bytes).sum();

        let now = Self::current_timestamp();
        let oldest_video_age_seconds = self
            .metadata
            .entries
            .values()
            .map(|e| now.saturating_sub(e.cached_at))
            .max();

        CacheStats {
            total_videos,
            total_size_bytes,
            oldest_video_age_seconds,
        }
    }

    /// Clears all cached videos
    pub async fn clear_all(&mut self) -> Result<usize, VideoError> {
        let count = self.metadata.entries.len();

        for (video_id, entry) in &self.metadata.entries {
            let path = PathBuf::from(&entry.video_path);
            if path.exists() {
                if let Err(e) = fs::remove_file(&path).await {
                    warn!("[VideoCacheManager] Failed to delete {}: {}", video_id, e);
                }
            }
        }

        self.metadata.entries.clear();
        self.save_metadata().await?;

        info!("[VideoCacheManager] Cleared {} videos from cache", count);
        Ok(count)
    }
}
