pub mod kling;

use std::sync::Arc;
use crate::ai::video::VideoProvider;

pub use kling::KlingProvider;

/// Builds the default list of video providers
pub fn build_default_video_providers() -> Vec<Arc<dyn VideoProvider>> {
    vec![
        Arc::new(KlingProvider::new()),
    ]
}
