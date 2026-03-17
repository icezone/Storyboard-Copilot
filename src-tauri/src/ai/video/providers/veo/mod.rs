use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobStatus};
use crate::ai::video::VideoProvider;

use super::kie_common::{self, KieApiClient, KIE_BASE_URL};

const SUPPORTED_MODELS: [&str; 4] = [
    "veo3",
    "veo3_fast",
    "veo/veo3",
    "veo/veo3_fast",
];

// Veo-specific endpoint (different from Kling/Sora2)
const VEO_GENERATE_PATH: &str = "/api/v1/veo/generate";

// Request/Response DTOs
#[derive(Debug, Serialize)]
struct VeoGenerateRequest {
    model: String,
    prompt: String,
    #[serde(rename = "imageUrls", skip_serializing_if = "Option::is_none")]
    image_urls: Option<Vec<String>>,
    #[serde(rename = "generationType")]
    generation_type: String,  // Fixed: "FIRST_AND_LAST_FRAMES_2_VIDEO"
    #[serde(rename = "aspectRatio", skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seeds: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct VeoGenerateResponse {
    code: i32,
    msg: String,
    data: Option<VeoGenerateData>,
}

#[derive(Debug, Deserialize)]
struct VeoGenerateData {
    #[serde(rename = "taskId")]
    task_id: String,
}

pub struct VeoProvider {
    client: KieApiClient,
    base_url: String,
}

impl VeoProvider {
    pub fn new() -> Self {
        Self {
            client: KieApiClient::new(),
            base_url: KIE_BASE_URL.to_string(),
        }
    }

    fn normalize_model(&self, model: &str) -> String {
        // Strip provider prefix if present (e.g., "veo/veo3" -> "veo3")
        model
            .split_once('/')
            .map(|(_, m)| m.to_string())
            .unwrap_or_else(|| model.to_string())
    }

    /// Validate and clamp seed to valid range [10000-99999]
    fn validate_seed(seed: Option<i64>) -> Option<i64> {
        seed.map(|s| {
            if s < 10000 || s > 99999 {
                warn!(
                    "[Veo] Seed {} outside valid range [10000-99999], clamping",
                    s
                );
                s.clamp(10000, 99999)
            } else {
                s
            }
        })
    }

    async fn submit_job(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        let endpoint = format!("{}{}", self.base_url, VEO_GENERATE_PATH);
        let api_key = self
            .client
            .get_api_key()
            .await
            .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

        let model = self.normalize_model(&request.model);

        // Upload start_frame_url if present and local
        let uploaded_start_frame = if let Some(ref start_url) = request.start_frame_url {
            let file_name = format!("veo-start-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, start_url, &file_name).await?)
        } else {
            None
        };

        // Upload end_frame_url if present and local
        let uploaded_end_frame = if let Some(ref end_url) = request.end_frame_url {
            let file_name = format!("veo-end-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, end_url, &file_name).await?)
        } else {
            None
        };

        // Build image_urls array: [start_frame, end_frame] (if both present)
        let image_urls = match (&uploaded_start_frame, &uploaded_end_frame) {
            (Some(start), Some(end)) => Some(vec![start.clone(), end.clone()]),
            (Some(start), None) => Some(vec![start.clone()]),
            (None, Some(end)) => Some(vec![end.clone()]),
            (None, None) => None,
        };

        // Validate and clamp seed
        let validated_seed = Self::validate_seed(request.seed);

        // Map aspect ratio: "auto" -> "Auto" (API expects capitalized)
        let aspect_ratio = request.aspect_ratio.map(|ratio| {
            if ratio.to_lowercase() == "auto" {
                "Auto".to_string()
            } else {
                ratio
            }
        });

        let body = VeoGenerateRequest {
            model,
            prompt: request.prompt.clone(),
            image_urls,
            generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO".to_string(),
            aspect_ratio,
            seeds: validated_seed,
        };

        info!("[Veo API] Request body: {:?}", serde_json::to_string(&body).unwrap_or_default());

        let auth_header = format!("Bearer {}", api_key);
        info!(
            "[Veo API] Creating task: {}, auth_length={}, auth_prefix={:?}",
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
                "Veo create task failed {}: {}",
                status, error_text
            )));
        }

        let result: VeoGenerateResponse = response.json().await?;

        if result.code != 200 {
            return Err(VideoError::Provider(format!(
                "Veo API error code {}: {}",
                result.code, result.msg
            )));
        }

        let task_id = result
            .data
            .ok_or_else(|| VideoError::Provider("Veo response missing data".to_string()))?
            .task_id;

        Ok(task_id)
    }

    async fn poll_job_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        kie_common::polling::poll_kie_job_status(&self.client, job_id).await
    }
}

impl Default for VeoProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl VideoProvider for VeoProvider {
    fn name(&self) -> &str {
        "veo"
    }

    fn supports_model(&self, model: &str) -> bool {
        if model.starts_with("veo/") {
            return true;
        }
        SUPPORTED_MODELS.contains(&model)
    }

    fn list_models(&self) -> Vec<String> {
        vec![
            "veo/veo3".to_string(),
            "veo/veo3_fast".to_string(),
        ]
    }

    async fn set_api_key(&self, api_key: String) -> Result<(), VideoError> {
        let trimmed = api_key.trim().to_string();
        info!(
            "[Veo] Setting API key: length={}, prefix={:?}",
            trimmed.len(),
            trimmed.chars().take(8).collect::<String>()
        );
        self.client.set_api_key(trimmed).await;
        Ok(())
    }

    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        info!(
            "[Veo Request] model: {}, aspect_ratio: {:?}, seed: {:?}",
            request.model, request.aspect_ratio, request.seed
        );

        self.submit_job(request).await
    }

    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        self.poll_job_status(job_id).await
    }
}
