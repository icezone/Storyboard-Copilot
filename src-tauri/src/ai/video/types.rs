use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoGenerateRequest {
    pub prompt: String,
    pub model: String,
    pub duration: Option<u32>,
    pub aspect_ratio: Option<String>,
    pub enable_audio: Option<bool>,
    pub seed: Option<i64>,
    pub start_frame_url: Option<String>,
    pub end_frame_url: Option<String>,
    pub extra_params: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VideoJobState {
    Pending,
    Processing,
    Completed,
    Failed,
    Timeout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoJobStatus {
    pub job_id: String,
    pub state: VideoJobState,
    pub progress: Option<f32>,
    pub video_url: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_videos: usize,
    pub total_size_bytes: u64,
    pub oldest_video_age_seconds: Option<u64>,
}
