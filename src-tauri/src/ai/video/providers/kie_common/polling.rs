// Job status polling functionality for KIE API providers
//
// Handles polling the KIE API for video generation job status and
// mapping KIE status strings to our internal VideoJobState enum.

use serde::Deserialize;
use tracing::info;

use crate::ai::video::error::VideoError;
use crate::ai::video::types::{VideoJobState, VideoJobStatus};

use super::{KieApiClient, KIE_BASE_URL, QUERY_TASK_PATH};

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

/// Poll the status of a KIE job
///
/// # Arguments
/// * `client` - The KieApiClient with API key
/// * `job_id` - The task ID returned from job submission
///
/// # Returns
/// VideoJobStatus with current state, progress, and video URL (if completed)
pub async fn poll_kie_job_status(
    client: &KieApiClient,
    job_id: &str,
) -> Result<VideoJobStatus, VideoError> {
    let endpoint = format!("{}{}?taskId={}", KIE_BASE_URL, QUERY_TASK_PATH, job_id);
    let api_key = client
        .get_api_key()
        .await
        .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

    info!("[KIE Polling] Querying task: {}", endpoint);
    let response = client
        .client()
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
            "KIE query task failed {}: {}",
            status, error_text
        )));
    }

    let result: KlingQueryResponse = response.json().await?;

    if result.code != 200 {
        return Err(VideoError::Provider(format!(
            "KIE API error code {}: {}",
            result.code, result.msg
        )));
    }

    let data = result
        .data
        .ok_or_else(|| VideoError::Provider("KIE query response missing data".to_string()))?;

    let state = map_kie_status_to_state(&data.state);

    info!(
        "[KIE Polling] Query response: state={}, result_json={:?}, progress={:?}",
        data.state, data.result_json, data.progress
    );

    // Extract video URL if completed
    let video_url = if state == VideoJobState::Completed {
        data.result_json
            .as_ref()
            .and_then(|json_str| {
                info!("[KIE Polling] Parsing result JSON: {}", json_str);
                let parsed = serde_json::from_str::<KlingResultJson>(json_str);
                match &parsed {
                    Ok(result) => {
                        info!("[KIE Polling] Parsed result URLs: {:?}", result.result_urls);
                    }
                    Err(e) => {
                        info!("[KIE Polling] Failed to parse result JSON: {}", e);
                    }
                }
                parsed
                    .ok()
                    .and_then(|result| result.result_urls.into_iter().next())
            })
    } else {
        None
    };

    info!("[KIE Polling] Final video_url: {:?}", video_url);

    // Get error message if failed
    let error_message = if state == VideoJobState::Failed {
        data.fail_msg
            .or_else(|| Some("Video generation failed".to_string()))
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

/// Map KIE status strings to VideoJobState enum
fn map_kie_status_to_state(status: &str) -> VideoJobState {
    match status.to_lowercase().as_str() {
        "waiting" | "queuing" => VideoJobState::Pending,
        "generating" => VideoJobState::Processing,
        "success" => VideoJobState::Completed,
        "fail" => VideoJobState::Failed,
        _ => VideoJobState::Processing, // Default to processing for unknown states
    }
}
