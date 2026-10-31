use std::{collections::HashMap, sync::Mutex};

use tokio::sync::watch;

use crate::error::CommandError;

#[derive(Default)]
pub struct TickStreams(Mutex<HashMap<String, watch::Sender<()>>>);

impl TickStreams {
    pub fn replace(&self, label: &str) -> Result<watch::Receiver<()>, CommandError> {
        let (sender, receiver) = watch::channel(());
        self.0
            .lock()
            .map_err(|_| CommandError::StreamUnavailable)?
            .insert(label.to_owned(), sender);
        // Dropping the previous sender cancels the previous subscription, even when
        // the old webview's IPC send still reports success after a reload.
        Ok(receiver)
    }

    pub fn cancel(&self, label: &str) {
        match self.0.lock() {
            Ok(mut streams) => {
                streams.remove(label);
            }
            Err(error) => tracing::error!(%error, window = label, "cancel tick subscription"),
        }
    }
}
