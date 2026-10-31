use std::time::Duration;

use core_app::{AppInfo, Tick};
use tauri::ipc::Channel;
use tokio::time::{Instant, MissedTickBehavior};

use crate::error::CommandError;
use crate::streams::TickStreams;

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(app))]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, CommandError> {
    let info = app.package_info();
    Ok(core_app::app_info(&info.name, &info.version.to_string())?)
}

// False means the receiver is gone; the loop owns no task after that point.
async fn stream_ticks(
    mut send: impl FnMut(Tick) -> bool,
    mut cancelled: tokio::sync::watch::Receiver<()>,
) {
    let start = Instant::now();
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut counter: u32 = 0;
    loop {
        tokio::select! {
            biased;
            _ = cancelled.changed() => return,
            _ = interval.tick() => {},
        }
        let Ok(elapsed_ms) = u32::try_from(start.elapsed().as_millis()) else {
            tracing::warn!("tick subscription reached its elapsed-time limit");
            return;
        };
        if !send(Tick {
            counter,
            elapsed_ms,
        }) {
            tracing::debug!("tick receiver disconnected");
            return;
        }
        let Some(next) = counter.checked_add(1) else {
            return;
        };
        counter = next;
    }
}

#[tauri::command]
#[specta::specta]
pub async fn subscribe_ticks(
    window: tauri::WebviewWindow,
    streams: tauri::State<'_, TickStreams>,
    on_tick: Channel<Tick>,
) -> Result<(), CommandError> {
    let cancelled = streams.replace(window.label()).inspect_err(|error| {
        tracing::error!(%error, window = window.label(), "start tick subscription");
    })?;
    stream_ticks(|tick| on_tick.send(tick).is_ok(), cancelled).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn skips_missed_intervals_and_stops_when_receiver_drops() {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let streams = TickStreams::default();
        let cancelled = streams.replace("main").unwrap();
        let task = tokio::spawn(stream_ticks(
            move |tick| sender.send(tick).is_ok(),
            cancelled,
        ));
        assert_eq!(receiver.recv().await.unwrap().counter, 0);
        tokio::time::advance(Duration::from_secs(5)).await;
        let late = receiver.recv().await.unwrap();
        assert_eq!(
            late,
            Tick {
                counter: 1,
                elapsed_ms: 5000
            }
        );
        tokio::task::yield_now().await;
        assert!(receiver.try_recv().is_err(), "no burst of catch-up ticks");
        tokio::time::advance(Duration::from_secs(1)).await;
        assert_eq!(receiver.recv().await.unwrap().counter, 2);
        drop(receiver);
        tokio::time::advance(Duration::from_secs(1)).await;
        task.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn replacing_a_subscription_stops_its_predecessor_despite_successful_sends() {
        let streams = TickStreams::default();
        let first = streams.replace("main").unwrap();
        let task = tokio::spawn(stream_ticks(|_| true, first));
        tokio::task::yield_now().await;
        let mut replacement = streams.replace("main").unwrap();
        tokio::time::timeout(Duration::from_millis(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            replacement.has_changed().is_ok(),
            "the replacement is still active"
        );
        streams.cancel("main");
        assert!(replacement.changed().await.is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn page_or_window_cancellation_stops_only_its_own_stream() {
        let streams = TickStreams::default();
        let cancelled = streams.replace("main").unwrap();
        let other = streams.replace("other").unwrap();
        let task = tokio::spawn(stream_ticks(|_| true, cancelled));
        tokio::task::yield_now().await;
        streams.cancel("main");
        tokio::time::timeout(Duration::from_millis(1), task)
            .await
            .unwrap()
            .unwrap();
        assert!(other.has_changed().is_ok());
    }
}
