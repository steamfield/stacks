//! Bind, serve, and stop cleanly: on the shutdown signal the server stops
//! accepting, waits for requests in flight up to the shutdown timeout, logs
//! `stopped` and returns.

use std::future::{Future, IntoFuture};
use std::sync::Arc;

use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app;
use crate::config::Config;
use crate::error::StartError;
use crate::notes::MemoryStore;

pub async fn run(
    config: Config,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<(), StartError> {
    let addr = config.addr();
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|source| StartError::Bind { addr, source })?;
    let local = listener
        .local_addr()
        .map_err(|source| StartError::Bind { addr, source })?;
    // The actual address: with PORT=0 this is where the OS put the server.
    tracing::info!(addr = %local, "listening");

    let app = app::router(Arc::new(MemoryStore::default()), config.request_timeout);
    let (stopping, stopped_waiting) = oneshot::channel();
    let server = axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown.await;
            tracing::info!("shutting down");
            // The receiver only goes away once the server has returned.
            let _ = stopping.send(());
        })
        .into_future();
    let deadline = async {
        // Only starts counting once the signal arrived.
        if stopped_waiting.await.is_ok() {
            tokio::time::sleep(config.shutdown_timeout).await;
        } else {
            std::future::pending::<()>().await;
        }
    };
    tokio::select! {
        result = server => result.map_err(StartError::Serve)?,
        () = deadline => return Err(StartError::ShutdownTimeout(config.shutdown_timeout)),
    }
    tracing::info!("stopped");
    Ok(())
}

/// Resolves on SIGINT (Ctrl+C) or, on Unix, SIGTERM. If a handler can't be
/// installed, that signal never resolves and the other still works.
pub async fn shutdown_signal() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[tokio::test]
    async fn a_port_in_use_is_a_bind_error() {
        let taken = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let config = Config {
            host: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: taken.local_addr().unwrap().port(),
            ..Config::default()
        };
        let error = run(config, std::future::ready(())).await.unwrap_err();
        assert_eq!((error.code(), error.exit_code()), ("BIND", 1));
    }

    #[tokio::test]
    async fn the_shutdown_future_stops_the_server() {
        let config = Config {
            port: 0,
            ..Config::default()
        };
        run(config, std::future::ready(())).await.unwrap();
    }
}
