use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobStatus};
use crate::ai::video::VideoProvider;

use super::kie_common::{self, KieApiClient, KIE_BASE_URL, CREATE_TASK_PATH};

const SUPPORTED_MODELS: [&str; 2] = [
    "kling-3.0",
    "kling/kling-3.0",
];

// Request/Response DTOs
#[derive(Debug, Serialize)]
struct KlingCreateTaskInput {
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sound: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_urls: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    multi_shots: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kling_elements: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct KlingCreateTaskRequest {
    model: String,
    input: KlingCreateTaskInput,
}

#[derive(Debug, Deserialize)]
struct KlingCreateTaskResponse {
    code: i32,
    msg: String,
    data: Option<KlingCreateTaskData>,
}

#[derive(Debug, Deserialize)]
struct KlingCreateTaskData {
    #[serde(rename = "taskId")]
    task_id: String,
}

pub struct KlingProvider {
    client: KieApiClient,
    base_url: String,
}

impl KlingProvider {
    pub fn new() -> Self {
        Self {
            client: KieApiClient::new(),
            base_url: KIE_BASE_URL.to_string(),
        }
    }

    fn normalize_model(&self, model: &str) -> String {
        // Strip provider prefix if present (e.g., "kling/kling-3.0" -> "kling-3.0")
        let base_model = model
            .split_once('/')
            .map(|(_, m)| m.to_string())
            .unwrap_or_else(|| model.to_string());

        // Remove "/video" suffix if present (for backwards compatibility)
        base_model.trim_end_matches("/video").to_string()
    }

    async fn submit_job(&self, request: VideoGenerateRequest) -> Result<String, VideoError> {
        let endpoint = format!("{}{}", self.base_url, CREATE_TASK_PATH);
        let api_key = self
            .client
            .get_api_key()
            .await
            .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

        let model = self.normalize_model(&request.model);

        // Build duration string (e.g., "5" for 5 seconds)
        let duration = request.duration.map(|d| d.to_string());

        // Extract extra parameters
        let mode = request.extra_params.as_ref()
            .and_then(|params| params.get("mode"))
            .and_then(|v| v.as_str())
            .unwrap_or("std");

        let multi_shots = request.extra_params.as_ref()
            .and_then(|params| params.get("multi_shots"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // Upload start_frame_url if present and local
        let uploaded_start_frame = if let Some(ref start_url) = request.start_frame_url {
            let file_name = format!("video-start-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, start_url, &file_name).await?)
        } else {
            None
        };

        // Upload end_frame_url if present and local
        let uploaded_end_frame = if let Some(ref end_url) = request.end_frame_url {
            let file_name = format!("video-end-frame-{}.png", Uuid::new_v4());
            Some(kie_common::upload::upload_image_file(&self.client, end_url, &file_name).await?)
        } else {
            None
        };

        // Build image_urls array based on start/end frames and multi_shots mode
        // Single shot mode: [start_frame_url, end_frame_url]
        // Multi-shot mode: [start_frame_url]
        let image_urls = if multi_shots {
            // Multi-shot mode: only start frame
            uploaded_start_frame.as_ref().map(|url| vec![url.clone()])
        } else {
            // Single shot mode: start and end frames
            match (&uploaded_start_frame, &uploaded_end_frame) {
                (Some(start), Some(end)) => Some(vec![start.clone(), end.clone()]),
                (Some(start), None) => Some(vec![start.clone()]),
                _ => None,
            }
        };

        // Process kling_elements: upload element_input_urls
        let kling_elements = if let Some(elements_value) = request.extra_params.as_ref()
            .and_then(|params| params.get("kling_elements"))
            .and_then(|v| v.as_array())
            .filter(|arr| !arr.is_empty())
        {
            let mut uploaded_elements = Vec::new();

            for element in elements_value {
                if let Some(obj) = element.as_object() {
                    let mut uploaded_element = obj.clone();

                    // Upload element_input_urls if present
                    if let Some(input_urls) = obj.get("element_input_urls").and_then(|v| v.as_array()) {
                        let mut uploaded_urls = Vec::new();

                        for (index, url_value) in input_urls.iter().enumerate() {
                            if let Some(url_str) = url_value.as_str() {
                                let element_name = obj.get("name")
                                    .and_then(|n| n.as_str())
                                    .unwrap_or("element");
                                let file_name = format!("element-{}-{}-{}.png", element_name, index, Uuid::new_v4());

                                let uploaded_url = kie_common::upload::upload_image_file(&self.client, url_str, &file_name).await?;
                                uploaded_urls.push(serde_json::Value::String(uploaded_url));
                            }
                        }

                        uploaded_element.insert("element_input_urls".to_string(), serde_json::Value::Array(uploaded_urls));
                    }

                    uploaded_elements.push(serde_json::Value::Object(uploaded_element));
                }
            }

            if !uploaded_elements.is_empty() {
                Some(serde_json::Value::Array(uploaded_elements))
            } else {
                None
            }
        } else {
            None
        };

        let input = KlingCreateTaskInput {
            prompt: request.prompt.clone(),
            sound: request.enable_audio,
            duration,
            aspect_ratio: request.aspect_ratio,
            mode: Some(mode.to_string()),
            image_urls,
            multi_shots: Some(multi_shots),
            kling_elements,
        };

        let body = KlingCreateTaskRequest {
            model: format!("{}/video", model),
            input,
        };

        info!("[Kling API] Request body: {:?}", serde_json::to_string(&body).unwrap_or_default());

        let auth_header = format!("Bearer {}", api_key);
        info!(
            "[Kling API] Creating task: {}, auth_length={}, auth_prefix={:?}",
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
                "Kling create task failed {}: {}",
                status, error_text
            )));
        }

        let result: KlingCreateTaskResponse = response.json().await?;

        if result.code != 200 {
            return Err(VideoError::Provider(format!(
                "Kling API error code {}: {}",
                result.code, result.msg
            )));
        }

        let task_id = result
            .data
            .ok_or_else(|| VideoError::Provider("Kling response missing data".to_string()))?
            .task_id;

        Ok(task_id)
    }

    async fn poll_job_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError> {
        kie_common::polling::poll_kie_job_status(&self.client, job_id).await
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
        let trimmed = api_key.trim().to_string();
        info!(
            "[Kling] Setting API key: length={}, prefix={:?}",
            trimmed.len(),
            trimmed.chars().take(8).collect::<String>()
        );
        self.client.set_api_key(trimmed).await;
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
