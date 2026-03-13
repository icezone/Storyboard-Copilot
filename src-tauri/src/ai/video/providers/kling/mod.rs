use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;
use uuid::Uuid;
use base64::{engine::general_purpose::STANDARD, Engine};

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoGenerateRequest, VideoJobState, VideoJobStatus};
use crate::ai::video::VideoProvider;

const KLING_BASE_URL: &str = "https://api.kie.ai";
const FILE_BASE_URL: &str = "https://kieai.redpandaai.co";
const CREATE_TASK_PATH: &str = "/api/v1/jobs/createTask";
const QUERY_TASK_PATH: &str = "/api/v1/jobs/recordInfo";
const FILE_UPLOAD_PATH: &str = "/api/file-stream-upload";
const UPLOAD_PATH: &str = "images/storyboard-copilot";

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

#[derive(Debug, Deserialize)]
struct KlingQueryResponse {
    code: i32,
    msg: String,
    data: Option<KlingQueryData>,
}

#[derive(Debug, Deserialize)]
struct KlingQueryData {
    #[serde(rename = "taskId")]
    task_id: String,
    state: String,
    #[serde(default, rename = "resultJson")]
    result_json: Option<String>,
    #[serde(default, rename = "failCode")]
    fail_code: Option<String>,
    #[serde(default, rename = "failMsg")]
    fail_msg: Option<String>,
    #[serde(default, rename = "createTime")]
    create_time: Option<i64>,
    #[serde(default, rename = "updateTime")]
    update_time: Option<i64>,
    #[serde(default)]
    progress: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct KlingResultJson {
    #[serde(rename = "resultUrls")]
    result_urls: Vec<String>,
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

fn source_to_bytes(source: &str) -> Result<Vec<u8>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("source is empty".to_string());
    }

    // If it's a data URL, extract the base64 part
    if let Some((meta, payload)) = trimmed.split_once(',') {
        if meta.starts_with("data:") && meta.ends_with(";base64") && !payload.is_empty() {
            return STANDARD
                .decode(payload)
                .map_err(|err| format!("invalid data-url base64 payload: {}", err));
        }
    }

    // If it looks like base64, decode it
    let likely_base64 = trimmed.len() > 256
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '/' || ch == '=');
    if likely_base64 {
        return STANDARD
            .decode(trimmed)
            .map_err(|err| format!("invalid base64 payload: {}", err));
    }

    // Check for unsupported protocols
    if trimmed.starts_with("asset://")
        || trimmed.starts_with("tauri://")
        || trimmed.starts_with("app://")
    {
        return Err(format!("unsupported local protocol source: {}", trimmed));
    }

    // Try to read as file path
    let path = if trimmed.starts_with("file://") {
        PathBuf::from(decode_file_url_path(trimmed))
    } else {
        PathBuf::from(trimmed)
    };
    std::fs::read(&path).map_err(|err| {
        format!(
            "failed to read path \"{}\": {}",
            path.to_string_lossy(),
            err
        )
    })
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn extract_uploaded_file_url(body: &Value) -> Option<String> {
    let candidates = [
        "/data/downloadUrl",
        "/data/fileUrl",
        "/data/file_url",
        "/data/url",
        "/data/download_url",
        "/fileUrl",
        "/file_url",
        "/url",
        "/downloadUrl",
        "/download_url",
    ];

    for pointer in candidates {
        let value = body.pointer(pointer).and_then(|raw| raw.as_str());
        if let Some(url) = value.filter(|raw| !raw.trim().is_empty()) {
            return Some(url.to_string());
        }
    }

    body.pointer("/data")
        .and_then(|raw| raw.as_str())
        .filter(|raw| !raw.trim().is_empty())
        .map(|url| url.to_string())
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

    async fn upload_image_file(
        &self,
        api_key: &str,
        source: &str,
        file_name: &str,
    ) -> Result<String, VideoError> {
        // If already an HTTP URL, return as-is
        if is_http_url(source) {
            return Ok(source.to_string());
        }

        // Convert source to bytes
        let bytes = source_to_bytes(source).map_err(|err| {
            VideoError::InvalidRequest(format!(
                "Failed to read image for Kling upload: {}; source={}",
                err, source
            ))
        })?;

        // Create multipart form
        let file_part = Part::bytes(bytes).file_name(file_name.to_string());
        let form = Form::new()
            .part("file", file_part)
            .text("uploadPath", UPLOAD_PATH.to_string())
            .text("fileName", file_name.to_string());

        // Upload to file service
        let endpoint = format!("{}{}", FILE_BASE_URL, FILE_UPLOAD_PATH);
        let response = self
            .client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let raw_response = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(VideoError::Provider(format!(
                "Kling file upload failed {}: {}",
                status, raw_response
            )));
        }

        // Parse response
        let body = serde_json::from_str::<Value>(&raw_response).map_err(|err| {
            VideoError::Provider(format!(
                "Kling file upload invalid JSON response: {}; raw={}",
                err, raw_response
            ))
        })?;

        // Check success status
        if body.get("success").and_then(|raw| raw.as_bool()) == Some(false)
            || body.get("code").and_then(|raw| raw.as_i64()).unwrap_or(200) >= 400
        {
            return Err(VideoError::Provider(format!(
                "Kling file upload rejected: {}",
                body.get("msg")
                    .and_then(|raw| raw.as_str())
                    .unwrap_or("unknown upload error")
            )));
        }

        // Extract file URL
        let uploaded_url = extract_uploaded_file_url(&body).ok_or_else(|| {
            VideoError::Provider(format!(
                "Kling file upload missing fileUrl, raw response: {}",
                body
            ))
        })?;

        // Validate URL
        if !is_http_url(&uploaded_url) {
            return Err(VideoError::Provider(format!(
                "Kling upload returned non-http URL: {}, raw response: {}",
                uploaded_url, body
            )));
        }

        Ok(uploaded_url)
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

    fn map_status_to_state(status: &str) -> VideoJobState {
        match status.to_lowercase().as_str() {
            "waiting" | "queuing" => VideoJobState::Pending,
            "generating" => VideoJobState::Processing,
            "success" => VideoJobState::Completed,
            "fail" => VideoJobState::Failed,
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
            Some(self.upload_image_file(&api_key, start_url, &file_name).await?)
        } else {
            None
        };

        // Upload end_frame_url if present and local
        let uploaded_end_frame = if let Some(ref end_url) = request.end_frame_url {
            let file_name = format!("video-end-frame-{}.png", Uuid::new_v4());
            Some(self.upload_image_file(&api_key, end_url, &file_name).await?)
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

                                let uploaded_url = self.upload_image_file(&api_key, url_str, &file_name).await?;
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
        let endpoint = format!("{}{}?taskId={}", self.base_url, QUERY_TASK_PATH, job_id);
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

        if result.code != 200 {
            return Err(VideoError::Provider(format!(
                "Kling API error code {}: {}",
                result.code, result.msg
            )));
        }

        let data = result
            .data
            .ok_or_else(|| VideoError::Provider("Kling query response missing data".to_string()))?;

        let state = Self::map_status_to_state(&data.state);

        info!(
            "[Kling API] Query response: state={}, result_json={:?}, progress={:?}",
            data.state,
            data.result_json,
            data.progress
        );

        // Extract video URL if completed
        let video_url = if state == VideoJobState::Completed {
            data.result_json
                .as_ref()
                .and_then(|json_str| {
                    info!("[Kling API] Parsing result JSON: {}", json_str);
                    let parsed = serde_json::from_str::<KlingResultJson>(json_str);
                    match &parsed {
                        Ok(result) => {
                            info!("[Kling API] Parsed result URLs: {:?}", result.result_urls);
                        }
                        Err(e) => {
                            info!("[Kling API] Failed to parse result JSON: {}", e);
                        }
                    }
                    parsed
                        .ok()
                        .and_then(|result| result.result_urls.into_iter().next())
                })
        } else {
            None
        };

        info!("[Kling API] Final video_url: {:?}", video_url);

        // Get error message if failed
        let error_message = if state == VideoJobState::Failed {
            data.fail_msg.or_else(|| Some("Video generation failed".to_string()))
        } else {
            None
        };

        // Convert progress from i32 to f32
        let progress = data.progress.map(|p| p as f32);

        Ok(VideoJobStatus {
            job_id: job_id.to_string(),
            state,
            progress,
            video_url,
            error_message,
            created_at: data.create_time,
            updated_at: data.update_time,
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
        let trimmed = api_key.trim().to_string();
        info!(
            "[Kling] Setting API key: length={}, prefix={:?}",
            trimmed.len(),
            trimmed.chars().take(8).collect::<String>()
        );
        let mut key = self.api_key.write().await;
        *key = Some(trimmed);
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
