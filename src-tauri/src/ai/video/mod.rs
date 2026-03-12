pub mod cache_manager;
pub mod error;
pub mod providers;
pub mod types;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::info;

use error::VideoError;
use types::{VideoGenerateRequest, VideoJobStatus};

#[async_trait::async_trait]
pub trait VideoProvider: Send + Sync {
    /// Returns the provider name (e.g., "kling")
    fn name(&self) -> &str;

    /// Checks if the provider supports a given model
    fn supports_model(&self, model: &str) -> bool;

    /// Lists all models supported by this provider
    fn list_models(&self) -> Vec<String> {
        Vec::new()
    }

    /// Sets the API key for this provider
    async fn set_api_key(&self, _api_key: String) -> Result<(), VideoError> {
        Err(VideoError::Provider(format!(
            "Provider '{}' does not support API key configuration",
            self.name()
        )))
    }

    /// Submits a video generation job and returns the job ID
    async fn generate(&self, request: VideoGenerateRequest) -> Result<String, VideoError>;

    /// Gets the current status of a video generation job
    async fn get_status(&self, job_id: &str) -> Result<VideoJobStatus, VideoError>;
}

pub struct VideoProviderRegistry {
    providers: HashMap<String, Arc<dyn VideoProvider>>,
    default_provider: Option<String>,
}

impl VideoProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: HashMap::new(),
            default_provider: None,
        }
    }

    pub fn register_provider(&mut self, provider: Arc<dyn VideoProvider>) {
        let name = provider.name().to_string();
        info!("Registering video provider: {}", name);
        self.providers.insert(name.clone(), provider);
        if self.default_provider.is_none() {
            self.default_provider = Some(name);
        }
    }

    pub fn get_provider(&self, name: &str) -> Option<&Arc<dyn VideoProvider>> {
        self.providers.get(name)
    }

    pub fn get_default_provider(&self) -> Option<&Arc<dyn VideoProvider>> {
        self.default_provider
            .as_ref()
            .and_then(|name| self.providers.get(name))
    }

    pub fn list_providers(&self) -> Vec<String> {
        let mut providers = self.providers.keys().cloned().collect::<Vec<String>>();
        providers.sort();
        providers
    }

    pub fn resolve_provider_for_model(&self, model: &str) -> Option<&Arc<dyn VideoProvider>> {
        // Try to extract provider from model ID (e.g., "kling/kling-3.0" -> "kling")
        if let Some((provider_id, _)) = model.split_once('/') {
            if let Some(provider) = self.providers.get(provider_id) {
                return Some(provider);
            }
        }

        // Fall back to checking each provider
        self.providers
            .values()
            .find(|provider| provider.supports_model(model))
    }

    pub fn supports_model(&self, model: &str) -> bool {
        self.providers
            .values()
            .any(|provider| provider.supports_model(model))
    }

    pub fn list_models(&self) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut models = Vec::new();

        for model in self
            .providers
            .values()
            .flat_map(|provider| provider.list_models())
        {
            if seen.insert(model.clone()) {
                models.push(model);
            }
        }

        models.sort();
        models
    }
}

impl Default for VideoProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}
