// Shared KIE API client infrastructure for Kling, Sora2, and Veo providers
//
// This module provides common functionality for all KIE-based video providers:
// - HTTP client with shared API key management
// - Image upload to KIE file service
// - Job status polling
//
// All three providers (Kling, Sora2, Veo) use the same KIE API infrastructure
// and share a single API key.

use reqwest::Client;
use std::sync::Arc;
use tokio::sync::RwLock;

pub mod polling;
pub mod upload;

// Re-export commonly used items
pub use polling::poll_kie_job_status;
pub use upload::upload_image_file;

// KIE API endpoints
pub const KIE_BASE_URL: &str = "https://api.kie.ai";
pub const FILE_BASE_URL: &str = "https://kieai.redpandaai.co";
pub const FILE_UPLOAD_PATH: &str = "/api/file-stream-upload";
pub const UPLOAD_PATH: &str = "images/storyboard-copilot";
pub const CREATE_TASK_PATH: &str = "/api/v1/jobs/createTask";
pub const QUERY_TASK_PATH: &str = "/api/v1/jobs/recordInfo";

/// Shared HTTP client for KIE API providers
///
/// Manages the HTTP client and API key storage that is shared across
/// all KIE-based providers (Kling, Sora2, Veo).
pub struct KieApiClient {
    client: Client,
    api_key: Arc<RwLock<Option<String>>>,
}

impl KieApiClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            api_key: Arc::new(RwLock::new(None)),
        }
    }

    /// Get a reference to the HTTP client
    pub fn client(&self) -> &Client {
        &self.client
    }

    /// Get the current API key (thread-safe)
    pub async fn get_api_key(&self) -> Option<String> {
        self.api_key.read().await.clone()
    }

    /// Set the API key (thread-safe)
    pub async fn set_api_key(&self, key: String) {
        let mut api_key = self.api_key.write().await;
        *api_key = Some(key);
    }
}

impl Default for KieApiClient {
    fn default() -> Self {
        Self::new()
    }
}
