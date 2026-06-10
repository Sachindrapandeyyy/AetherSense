//! CSI telemetry payload cryptographic signing and verification (ADR-032).

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Signs and verifies CSI telemetry payloads between swarm nodes.
pub struct CsiPayloadSigner {
    key: [u8; 32],
}

impl CsiPayloadSigner {
    /// Create a new CSI payload signer with a shared key.
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// Sign the CSI payload by generating a 32-byte HMAC-SHA256 signature.
    pub fn sign(&self, node_id: u32, timestamp_ms: u64, amplitudes: &[f32]) -> [u8; 32] {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .expect("HMAC accepts any key length");
        mac.update(&node_id.to_le_bytes());
        mac.update(&timestamp_ms.to_le_bytes());
        for &val in amplitudes {
            mac.update(&val.to_le_bytes());
        }
        let result = mac.finalize().into_bytes();
        let mut sig = [0u8; 32];
        sig.copy_from_slice(&result);
        sig
    }

    /// Verify that the signature is valid for the given CSI telemetry payload.
    pub fn verify(
        &self,
        node_id: u32,
        timestamp_ms: u64,
        amplitudes: &[f32],
        signature: &[u8; 32],
    ) -> bool {
        let mut mac = HmacSha256::new_from_slice(&self.key)
            .expect("HMAC accepts any key length");
        mac.update(&node_id.to_le_bytes());
        mac.update(&timestamp_ms.to_le_bytes());
        for &val in amplitudes {
            mac.update(&val.to_le_bytes());
        }
        let result = mac.finalize().into_bytes();
        result.as_slice() == signature.as_ref()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_csi_payload_signing() {
        let signer = CsiPayloadSigner::new([0xCCu8; 32]);
        let amps = vec![1.2, 0.8, -0.5, 2.2];
        let sig = signer.sign(42, 123456789, &amps);
        assert!(signer.verify(42, 123456789, &amps, &sig));
        assert!(!signer.verify(43, 123456789, &amps, &sig));
        assert!(!signer.verify(42, 123456780, &amps, &sig));
    }
}
