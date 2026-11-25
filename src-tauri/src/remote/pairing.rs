//! Pairing code: 6 digits shown on the host, typed on the client. Exchanged with SPAKE2, bound to both endpoint
//! ids (themselves authenticated by QUIC/TLS), then confirmed both ways: a wrong code never pairs, and a device
//! that listens or impersonates the host can test at most one guess per attempt (no offline brute force).

use serde::Serialize;
use spake2::{Ed25519Group, Identity, Password, Spake2};
use ts_rs::TS;

use crate::error::{AppError, AppResult};

/// How long a code stays valid.
pub const CODE_TTL_MS: i64 = 2 * 60 * 1000;
/// Wrong codes tolerated before the pairing window closes.
pub const MAX_ATTEMPTS: u8 = 3;

/// The pairing window opened on the host.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PairingCode {
    pub code: String,
    #[ts(type = "number")]
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
pub struct PairingWindow {
    pub code: PairingCode,
    pub failures: u8,
}

impl PairingWindow {
    pub fn open(now: i64) -> Self {
        Self { code: PairingCode { code: new_code(), expires_at: now + CODE_TTL_MS }, failures: 0 }
    }

    pub fn is_open(&self, now: i64) -> bool {
        now < self.code.expires_at && self.failures < MAX_ATTEMPTS
    }
}

/// 6 random digits (UUID v4 randomness; the modulo bias on 2³² is negligible).
fn new_code() -> String {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    let n = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{n:06}")
}

/// Digits only: « 123 456 » and « 123-456 » are accepted.
pub fn normalize(code: &str) -> String {
    code.chars().filter(char::is_ascii_digit).collect()
}

/// Side of the exchange.
#[derive(Debug, Clone, Copy)]
pub enum Role {
    /// The device that will control (types the code).
    Client,
    /// The device that will be controlled (shows the code).
    Host,
}

/// SPAKE2 state of one side. `client_id` / `host_id`: the two endpoint ids.
pub struct Exchange {
    spake: Spake2<Ed25519Group>,
    role: Role,
    client_id: [u8; 32],
    host_id: [u8; 32],
}

impl Exchange {
    /// Starts the exchange; returns the message to send to the other side.
    pub fn start(role: Role, code: &str, client_id: [u8; 32], host_id: [u8; 32]) -> (Self, Vec<u8>) {
        let password = Password::new(normalize(code).as_bytes());
        let (a, b) = (Identity::new(&client_id), Identity::new(&host_id));
        let (spake, message) = match role {
            Role::Client => Spake2::<Ed25519Group>::start_a(&password, &a, &b),
            Role::Host => Spake2::<Ed25519Group>::start_b(&password, &a, &b),
        };
        (Self { spake, role, client_id, host_id }, message)
    }

    /// Finishes with the other side's message; returns the shared key (identical on both sides only when both
    /// typed the same code).
    pub fn finish(self, other: &[u8]) -> AppResult<Keys> {
        let key = self.spake.finish(other).map_err(|_| AppError::Invalid(wrong_code()))?;
        let key: [u8; 32] = key.try_into().map_err(|_| AppError::Invalid(wrong_code()))?;
        Ok(Keys { key, role: self.role, client_id: self.client_id, host_id: self.host_id })
    }
}

/// Shared key of a finished exchange.
pub struct Keys {
    key: [u8; 32],
    role: Role,
    client_id: [u8; 32],
    host_id: [u8; 32],
}

impl Keys {
    fn confirmation(&self, of: Role) -> blake3::Hash {
        let label: &[u8] = match of {
            Role::Client => b"neuron pairing v1: client",
            Role::Host => b"neuron pairing v1: host",
        };
        let mut hasher = blake3::Hasher::new_keyed(&self.key);
        hasher.update(label).update(&self.client_id).update(&self.host_id);
        hasher.finalize()
    }

    /// Proof that this side derived the key.
    pub fn own_confirmation(&self) -> Vec<u8> {
        self.confirmation(self.role).as_bytes().to_vec()
    }

    /// Checks the other side's proof (constant-time comparison).
    pub fn verify(&self, theirs: &[u8]) -> bool {
        let other = match self.role {
            Role::Client => Role::Host,
            Role::Host => Role::Client,
        };
        let Ok(bytes) = <[u8; 32]>::try_from(theirs) else { return false };
        self.confirmation(other) == blake3::Hash::from_bytes(bytes)
    }
}

pub fn wrong_code() -> String {
    crate::tr!("code incorrect ou expiré", "wrong or expired code")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(client_code: &str, host_code: &str) -> (bool, bool) {
        let (c, h) = ([1u8; 32], [2u8; 32]);
        let (client, to_host) = Exchange::start(Role::Client, client_code, c, h);
        let (host, to_client) = Exchange::start(Role::Host, host_code, c, h);
        let host_keys = host.finish(&to_host).unwrap();
        let client_keys = client.finish(&to_client).unwrap();
        (client_keys.verify(&host_keys.own_confirmation()), host_keys.verify(&client_keys.own_confirmation()))
    }

    #[test]
    fn same_code_confirms_both_ways() {
        assert_eq!(run("123456", "123 456"), (true, true));
    }

    #[test]
    fn wrong_code_never_confirms() {
        assert_eq!(run("123456", "123457"), (false, false));
    }

    #[test]
    fn a_confirmation_is_not_reusable_as_the_other_side() {
        let (c, h) = ([1u8; 32], [2u8; 32]);
        let (client, to_host) = Exchange::start(Role::Client, "000000", c, h);
        let (host, to_client) = Exchange::start(Role::Host, "000000", c, h);
        let host_keys = host.finish(&to_host).unwrap();
        let client_keys = client.finish(&to_client).unwrap();
        // Reflecting the host's own proof back to it fails.
        assert!(!host_keys.verify(&host_keys.own_confirmation()));
        assert!(!client_keys.verify(&[0u8; 5]));
    }

    #[test]
    fn window_and_codes() {
        let w = PairingWindow::open(1000);
        assert_eq!(w.code.code.len(), 6);
        assert!(w.code.code.chars().all(|c| c.is_ascii_digit()));
        assert!(w.is_open(1000) && !w.is_open(1000 + CODE_TTL_MS));
        let closed = PairingWindow { failures: MAX_ATTEMPTS, ..w };
        assert!(!closed.is_open(1000));
    }
}
