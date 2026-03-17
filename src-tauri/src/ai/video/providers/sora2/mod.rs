use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobStatus};
use crate::ai::video::VideoProvider;

use super::kie_common::{self, KieApiClient, KIE_BASE_URL, CREATE_TASK_PATH};

const SUPPORTED_MODELS: [&str; 4] = [
    "sora-2-image-to-video",
    "sora-2-pro-image-to-video",
    "sora2/sora-2-image-to-video",
    "sora2/sora-2-pro-image-to-video",
];

// Request/Response DTOs
#[derive(Debug, Serialize)]
struct Sora2CreateTaskInput {
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_urls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    n_frames: Option<u32>,
}

#[derive(Debug, Serialize)]
struct Sora2CreateTaskRequest {
    model: String,
    input: Sora2CreateTaskInput,
}

#[derive(Debug, Deserialize)]
struct Sora2CreateTaskResponse {
    code: i32,
    msg: String,
    data: Option<Sora2CreateTaskData>,
}

#[derive(Debug, Deserialize)]
struct Sora2CreateTaskData {
    #[serde(rename = "taskId")]
    task_id: String,
}

pub struct Sora2Provider {
    client: KieApiClient,
    base_url: String,
}

impl Sora2Provider {
    pub fn new() -> Self {
        Self {
            client: KieApiClient::new(),
            base_url: KIE_BASE_URL.to_string(),
        }
    }

    fn normalize_model(&self, model: &str) -> String {
        // Strip provider prefix if present (e.g., "sora2/sora-2-image-to-video" -> "sora-2-image-to-video")
        let base_model = model
            .split_once('/')
            .map(|(_, m)| m.to_string())
            .unwrap_or_else(|| model.to_string());

        // Remove "/video" suffix if present (for backwards compatibility)
        base_model.trim_end_matches("/video").to_string()
    }

    fn map_aspect_ratio(&self, ratio: &str) -> String {
        // Map aspect ratio: 9:16 -> "portrait", others -> "landscape"
        match ratio {
            "9:16" => "portrait".to_string(),
            _ => "landscape".to_string(),
        }
    }

    fn map_duration_to_frames(&self, duration: u32) -> u32 {
        // 1:1 mapping: duration in seconds = n_frames
        duration
    }

    async fn submit_job(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        let endpoint = format!("{}{}", self.base_url, CREATE_TASK_PATH);
        let api_key = self
            .client
            .get_api_key()
            .await
            .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

        let model = self.normalize_model(&request.model);

        // Map duration to n_frames (1:1 ratio)
        let n_frames = request.duration.map(|d| self.map_duration_to_frames(d));

        // Map aspect ratio to portrait/landscape
        let aspect_ratio = request
            .aspect_ratio
            .as_ref()
            .map(|ratio| self.map_aspect_ratio(ratio));

        // Upload start_frame_url if present and local
        let uploaded_start_frame = if let Some(ref start_url) = request.start_frame_url {
            let file_name = format!("sora2-start-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, start_url, &file_name).await?)
        } else {
            None
        };

        // Upload end_frame_url if present and local
        let uploaded_end_frame = if let Some(ref end_url) = request.end_frame_url {
            let file_name = format!("sora2-end-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, end_url, &file_name).await?)
        } else {
            None
        };

        // Build image_urls array: [start_frame, end_frame] or [start_frame] or None
        let image_urls = match (&uploaded_start_frame, &uploaded_end_frame) {
            (Some(start), Some(end)) => Some(vec![start.clone(), end.clone()]),
            (Some(start), None) => Some(vec![start.clone()]),
            _ => None,
        };

        let input = Sora2CreateTaskInput {
            prompt: request.prompt.clone(),
            image_urls,
            aspect_ratio,
            n_frames,
        };

        let body = Sora2CreateTaskRequest {
            model,
            input,
        };

        info!("[Sora2 API] Request body: {:?}", serde_json::to_string(&body).unwrap_or_default());

        let auth_header = format!("Bearer {}", api_key);
        info!(
            "[Sora2 API] Creating task: {}, auth_length={}, auth_prefix={:?}",
            endpoint,
            auth_header.len(),
            auth_header.chars().take(15).collect::<String>()
        );

        let response = self
            .client
            .client()
            .post(&endpoint)
            .header("Authorization", auth_header)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(VideoError::Provider(format!(
                "Sora2 create task failed {}: {}",
                status, error_text
            )));
        }

        let result: Sora2CreateTaskResponse = response.json().await?;

        if result.code != 200 {
            return Err(VideoError::Provider(format!(
                "Sora2 API error code {}: {}",
                result.code, result.msg
            )));
        }

        let task_id = result
            .data
            .ok_or_else(|| VideoError::Provider("Sora2 response missing data".to_string()))?
            .task_id;

        Ok(task_id)
    }

    async fn poll_job_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        kie_common::polling::poll_kie_job_status(&self.client, job_id).await
    }
}

impl Default for Sora2Provider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl VideoProvider for Sora2Provider {
    fn name(&self) -> &str {
        "sora2"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("sora2/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "sora2/sora-2-image-to-video".to_string(),
            "sora2/sora-2-pro-image-to-video".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), VideoError> {
        let trimmed = api_key.trim().to_string();
        info!(
            "[Sora2] Setting API key: length={}, prefix={:?}",
            trimmed.len(),
            trimmed.chars().take(8).collect::<String>()
        );
        self.client.set_api_key(trimmed).await;
        Ok(())
    }

    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        info!(
            "[Sora2 Request] model: {}, duration: {:?}, aspect_ratio: {:?}",
            request.model, request.duration, request.aspect_ratio
        );

        self.submit_job(request).await
    }

    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        self.poll_job_status(job_id).await
    }
}
