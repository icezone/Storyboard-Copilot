pub mod kie_common;
pub mod kling;
pub mod sora2;
pub mod veo;

use std::sync::Arc;
use crate::ai::video::VideoProvider;

pub use kling::KlingProvider;
pub use sora2::Sora2Provider;
pub use veo::VeoProvider;

/// Builds the default list of video providers
pub fn build_default_video_providers() -> Vec<Arc<dyn VideoProvider>> {
    vec![
        Arc::new(KlingProvider::new()),
        Arc::new(Sora2Provider::new()),
        Arc::new(VeoProvider::new()),
    ]
}
