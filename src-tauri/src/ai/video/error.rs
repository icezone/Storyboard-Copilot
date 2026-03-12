use thiserror::Error;

#[derive(Error, Debug)]
pub enum VideoError {
    #[error("Provider error: {0}")]
    Provider(String),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Model not supported: {0}")]
    ModelNotSupported(String),

    #[error("Job not found: {0}")]
    JobNotFound(String),

    #[error("Job failed: {0}")]
    JobFailed(String),

    #[error("Job timeout: {0}")]
    JobTimeout(String),

    #[error("Cache error: {0}")]
    Cache(String),

    #[error("Processing error: {0}")]
    Processing(String),
}

impl serde::Serialize for VideoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
