use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;
use base64::{engine::general_purpose::STANDARD, Engine};

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobState, VideoJobStatus};
use crate::ai::video::VideoProvider;

const KLING_BASE_URL: &str = "https://api.klingai.com";
const CREATE_TASK_PATH: &str = "/v1/videos/text2video";
const QUERY_TASK_PATH: &str = "/v1/videos/text2video";

const SUPPORTED_MODELS: [&str; 2] = [
    "kling-3.0",
    "kling/kling-3.0",
];

// Request/Response DTOs
#[derive(Debug, Serialize)]
struct KlingCreateTaskRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    negative_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cfg_scale: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    camera_control: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_urls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    multi_shots: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kling_elements: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct KlingCreateTaskResponse {
    code: i32,
    message: String,
    #[serde(default)]
    request_id: Option<String>,
    data: Option<KlingTaskData>,
}

#[derive(Debug, Deserialize)]
struct KlingTaskData {
    task_id: String,
    #[serde(default)]
    task_status: Option<String>,
    #[serde(default)]
    created_at: Option<i64>,
    #[serde(default)]
    updated_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct KlingQueryResponse {
    code: i32,
    message: String,
    data: Option<KlingQueryData>,
}

#[derive(Debug, Deserialize)]
struct KlingQueryData {
    task_id: String,
    task_status: String,
    #[serde(default)]
    task_status_msg: Option<String>,
    #[serde(default)]
    created_at: Option<i64>,
    #[serde(default)]
    updated_at: Option<i64>,
    #[serde(default)]
    task_result: Option<KlingTaskResult>,
}

#[derive(Debug, Deserialize)]
struct KlingTaskResult {
    #[serde(default)]
    videos: Option<Vec<KlingVideo>>,
}

#[derive(Debug, Deserialize)]
struct KlingVideo {
    id: String,
    url: String,
    #[serde(default)]
    duration: Option<f32>,
}

fn decode_file_url_path(value: &str) -> String {
    let raw = value.trim_start_matches("file://");
    let decoded = urlencoding::decode(raw)
        .map(|result| result.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let normalized = if decoded.starts_with('/')
        && decoded.len() > 2
        && decoded.as_bytes().get(2) == Some(&b':')
    {
        &decoded[1..]
    } else {
        &decoded
    };
    normalized.to_string()
}

fn encode_reference_image(source: &str) -> Result<String, VideoError> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err(VideoError::InvalidRequest("Reference image is empty".to_string()));
    }

    // If it's already a URL, return as-is
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }

    // If it's a data URL, extract the base64 part
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return Ok(format!("data:image/jpeg;base64,{}", payload));
        }
    }

    // If it looks like base64, wrap it
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return Ok(format!("data:image/jpeg;base64,{}", trimmed));
    }

    // Try to read as file path
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };

    let bytes = std::fs::read(&path)
        .map_err(|e| VideoError::Io(e))?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:image/jpeg;base64,{}", encoded))
}

pub struct KlingProvider {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
    base_url: String,
}

impl KlingProvider {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
            base_url: KLING_BASE_URL.to_string(),
        }
    }

    fn normalize_model(&self, model: &str) -> String {
        // Strip provider prefix if present
        model
            .split_once('/')
            .map(|(_, m)| m.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    fn map_status_to_state(status: &str) -> VideoJobState {
        match status.to_lowercase().as_str() {
            "submitted" | "pending" => VideoJobState::Pending,
            "processing" => VideoJobState::Processing,
            "succeed" | "completed" => VideoJobState::Completed,
            "failed" => VideoJobState::Failed,
            _ => VideoJobState::Processing, // Default to processing for unknown states
        }
    }

    async fn submit_job(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        let endpoint = format!("{}{}", self.base_url, CREATE_TASK_PATH);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

        let model = self.normalize_model(&request.model);

        // Build duration string (e.g., "5" for 5 seconds)
        let duration = request.duration.map(|d| d.to_string());

        // Extract extra parameters
        let multi_shots = request.extra_params.as_ref()
            .and_then(|params| params.get("multi_shots"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let kling_elements = request.extra_params.as_ref()
            .and_then(|params| params.get("kling_elements"))
            .and_then(|v| {
                // Check if it's an array with at least one element
                if let Some(arr) = v.as_array() {
                    if !arr.is_empty() {
                        return Some(v.clone());
                    }
                }
                None
            });

        // Build image_urls array based on start/end frames and multi_shots mode
        // Single shot mode: [start_frame_url, end_frame_url]
        // Multi-shot mode: [start_frame_url]
        let image_urls = if multi_shots {
            // Multi-shot mode: only start frame
            request.start_frame_url.as_ref().map(|url| vec![url.clone()])
        } else {
            // Single shot mode: start and end frames
            match (&request.start_frame_url, &request.end_frame_url) {
                (Some(start), Some(end)) => Some(vec![start.clone(), end.clone()]),
                (Some(start), None) => Some(vec![start.clone()]),
                _ => None,
            }
        };

        let body = KlingCreateTaskRequest {
            model,
            prompt: request.prompt.clone(),
            negative_prompt: None,
            cfg_scale: None,
            mode: Some("std".to_string()), // Standard mode
            camera_control: None,
            duration,
            aspect_ratio: request.aspect_ratio,
            image_urls,
            multi_shots: Some(multi_shots),
            kling_elements,
        };

        info!("[Kling API] Creating task: {}", endpoint);
        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(VideoError::Provider(format!(
                "Kling create task failed {}: {}",
                status, error_text
            )));
        }

        let result: KlingCreateTaskResponse = response.json().await?;

        if result.code != 0 {
            return Err(VideoError::Provider(format!(
                "Kling API error code {}: {}",
                result.code, result.message
            )));
        }

        let task_id = result
            .data
            .ok_or_else(|| VideoError::Provider("Kling response missing data".to_string()))?
            .task_id;

        Ok(task_id)
    }

    async fn poll_job_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        let endpoint = format!("{}{}/{}", self.base_url, QUERY_TASK_PATH, job_id);
        let api_key = self
            .api_key
            .read()
            .await
            .clone()
            .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

        info!("[Kling API] Querying task: {}", endpoint);
        let response = self
            .client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();

            // Check for 404 - job not found
            if status.as_u16() == 404 {
                return Err(VideoError::JobNotFound(format!("Job {} not found", job_id)));
            }

            return Err(VideoError::Provider(format!(
                "Kling query task failed {}: {}",
                status, error_text
            )));
        }

        let result: KlingQueryResponse = response.json().await?;

        if result.code != 0 {
            return Err(VideoError::Provider(format!(
                "Kling API error code {}: {}",
                result.code, result.message
            )));
        }

        let data = result
            .data
            .ok_or_else(|| VideoError::Provider("Kling query response missing data".to_string()))?;

        let state = Self::map_status_to_state(&data.task_status);

        // Extract video URL if completed
        let video_url = if state == VideoJobState::Completed {
            data.task_result
                .and_then(|result| result.videos)
                .and_then(|videos| videos.into_iter().next())
                .map(|video| video.url)
        } else {
            None
        };

        // Get error message if failed
        let error_message = if state == VideoJobState::Failed {
            data.task_status_msg.or_else(|| Some("Video generation failed".to_string()))
        } else {
            None
        };

        Ok(VideoJobStatus {
            job_id: job_id.to_string(),
            state,
            progress: None, // Kling doesn't provide progress percentage
            video_url,
            error_message,
            created_at: data.created_at,
            updated_at: data.updated_at,
        })
    }
}

impl Default for KlingProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl VideoProvider for KlingProvider {
    fn name(&self) -> &str {
        "kling"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("kling/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec!["kling/kling-3.0".to_string()]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), VideoError> {
        let mut key = self.api_key.write().await;
        *key = Some(api_key);
        Ok(())
    }

    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        info!(
            "[Kling Request] model: {}, duration: {:?}, aspect_ratio: {:?}",
            request.model, request.duration, request.aspect_ratio
        );

        self.submit_job(request).await
    }

    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        self.poll_job_status(job_id).await
    }
}
