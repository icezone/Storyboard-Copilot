// Image upload functionality for KIE API providers
//
// Handles uploading images to the KIE file service, supporting multiple input formats:
// - Local file paths (file:// URLs or direct paths)
// - HTTP URLs (returned as-is without upload)
// - Data URLs (data:image/png;base64,...)
// - Raw base64 strings

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::multipart::{Form, Part};
use serde_json::Value;
use std::path::PathBuf;
use tracing::info;

use crate::ai::video::error::VideoError;

use super::{KieApiClient, FILE_BASE_URL, FILE_UPLOAD_PATH, UPLOAD_PATH};

/// Upload an image file to KIE file service
///
/// # Arguments
/// * `client` - The KieApiClient with API key
/// * `source` - Image source (file path, HTTP URL, data URL, or base64)
/// * `file_name` - Desired filename for the uploaded file
///
/// # Returns
/// The HTTP URL of the uploaded file, or the original URL if already HTTP
pub async fn upload_image_file(
    client: &KieApiClient,
    source: &str,
    file_name: &str,
) -> Result<String, VideoError> {
    // If already an HTTP URL, return as-is
    if is_http_url(source) {
        return Ok(source.to_string());
    }

    let api_key = client
        .get_api_key()
        .await
        .ok_or_else(|| VideoError::InvalidRequest("API key not set".to_string()))?;

    // Convert source to bytes
    let bytes = source_to_bytes(source).map_err(|err| {
        VideoError::InvalidRequest(format!(
            "Failed to read image for KIE upload: {}; source={}",
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
    info!("[KIE Upload] Uploading to: {}", endpoint);

    let response = client
        .client()
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await?;

    let status = response.status();
    let raw_response = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(VideoError::Provider(format!(
            "KIE file upload failed {}: {}",
            status, raw_response
        )));
    }

    // Parse response
    let body = serde_json::from_str::<Value>(&raw_response).map_err(|err| {
        VideoError::Provider(format!(
            "KIE file upload invalid JSON response: {}; raw={}",
            err, raw_response
        ))
    })?;

    // Check success status
    if body.get("success").and_then(|raw| raw.as_bool()) == Some(false)
        || body.get("code").and_then(|raw| raw.as_i64()).unwrap_or(200) >= 400
    {
        return Err(VideoError::Provider(format!(
            "KIE file upload rejected: {}",
            body.get("msg")
                .and_then(|raw| raw.as_str())
                .unwrap_or("unknown upload error")
        )));
    }

    // Extract file URL
    let uploaded_url = extract_uploaded_file_url(&body).ok_or_else(|| {
        VideoError::Provider(format!(
            "KIE file upload missing fileUrl, raw response: {}",
            body
        ))
    })?;

    // Validate URL
    if !is_http_url(&uploaded_url) {
        return Err(VideoError::Provider(format!(
            "KIE upload returned non-http URL: {}, raw response: {}",
            uploaded_url, body
        )));
    }

    info!("[KIE Upload] Success: {}", uploaded_url);
    Ok(uploaded_url)
}

/// Convert various image source formats to bytes
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

/// Check if a string is an HTTP or HTTPS URL
fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

/// Extract the uploaded file URL from KIE upload response
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

/// Decode file:// URL path and normalize Windows paths
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
