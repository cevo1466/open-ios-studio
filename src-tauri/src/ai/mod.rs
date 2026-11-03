//! AI engine: provider-neutral chat request builders, streaming response parsers and the async
//! HTTP runtime. API keys are passed in by the caller and are never logged or put in errors.
//!
//! Split by responsibility: `types` (shared data), `endpoints` (URLs and request building),
//! `stream` (response parsing and error mapping), `http` (the async runtime).

mod endpoints;
mod http;
mod stream;
mod types;

#[cfg(test)]
mod tests;

pub use endpoints::Endpoints;
pub use http::{list_models, stream_chat};
pub use types::{AiEvent, ChatRequest, Message, ModelInfo, Provider};
