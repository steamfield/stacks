//! `--healthcheck`: request `/healthz` from the server HOST and PORT name and
//! exit 0 on HTTP 200, 1 otherwise. A distroless image has no shell or curl,
//! so its `HEALTHCHECK` runs the binary itself.

use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

use crate::config::{Config, Env};
use crate::error::StartError;

const TIMEOUT: Duration = Duration::from_secs(2);

pub fn healthcheck(env: &Env) -> Result<(), StartError> {
    let config = Config::load(env)?;
    let status = get_status(target(config.addr()), "/healthz")
        .map_err(|e| StartError::Unhealthy(e.to_string()))?;
    if status == 200 {
        Ok(())
    } else {
        Err(StartError::Unhealthy(format!("/healthz answered {status}")))
    }
}

/// A wildcard bind (0.0.0.0, ::) is probed on the matching loopback address.
pub fn target(addr: SocketAddr) -> SocketAddr {
    let ip = match addr.ip() {
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        ip => ip,
    };
    SocketAddr::new(ip, addr.port())
}

/// One HTTP/1.1 GET with `Connection: close`; returns the status code.
pub fn get_status(addr: SocketAddr, path: &str) -> std::io::Result<u16> {
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT)?;
    stream.set_read_timeout(Some(TIMEOUT))?;
    stream.set_write_timeout(Some(TIMEOUT))?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n"
    )?;
    let mut head = [0_u8; 12];
    stream.read_exact(&mut head)?;
    // "HTTP/1.1 200"
    std::str::from_utf8(&head[9..12])
        .ok()
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| std::io::Error::other("not an HTTP response"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_binds_are_probed_on_loopback() {
        assert_eq!(
            target("0.0.0.0:80".parse().unwrap()),
            "127.0.0.1:80".parse().unwrap()
        );
        assert_eq!(
            target("[::]:80".parse().unwrap()),
            "[::1]:80".parse().unwrap()
        );
        assert_eq!(
            target("10.0.0.2:80".parse().unwrap()),
            "10.0.0.2:80".parse().unwrap()
        );
    }

    #[test]
    fn nothing_listening_is_unhealthy() {
        let free = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = free.local_addr().unwrap().port().to_string();
        drop(free);
        let error = healthcheck(&Env::from([("PORT", port.as_str())])).unwrap_err();
        assert_eq!((error.code(), error.exit_code()), ("UNHEALTHY", 1));
    }
}
