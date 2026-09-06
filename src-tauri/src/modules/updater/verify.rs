use base64::Engine;
use minisign_verify::{PublicKey, Signature};

/// Verifies `data` against `signature` using the pubkey exactly as stored in
/// `tauri.conf.json`, base64 of the two-line minisign public key file.
pub fn verify(pubkey_field: &str, data: &[u8], signature: &str) -> Result<(), String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(pubkey_field.trim())
        .map_err(|e| format!("updater pubkey is not valid base64: {e}"))?;
    let text =
        String::from_utf8(decoded).map_err(|e| format!("updater pubkey is not utf-8: {e}"))?;

    let key = PublicKey::decode(&text).map_err(|e| format!("invalid updater pubkey: {e}"))?;

    let decoded_sig = base64::engine::general_purpose::STANDARD
        .decode(signature.trim())
        .map_err(|e| format!("signature is not valid base64: {e}"))?;
    let sig_text =
        String::from_utf8(decoded_sig).map_err(|e| format!("signature is not utf-8: {e}"))?;
    let sig = Signature::decode(&sig_text).map_err(|e| format!("invalid signature: {e}"))?;

    key.verify(data, &sig, false)
        .map_err(|e| format!("signature verification failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Throwaway keypair generated for tests only, see the plan's Task 3.
    const FIXTURE_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQzMjg0MUQ2NThDNEFFRjAKUldUd3JzUlkxa0VvUS8vdTFWUUpYS1ZUWC9aUU5WbkphT2VKcm5reUhSdWpXcnRsaFA0T0Vtb2YK";
    const FIXTURE_SIG: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUd3JzUlkxa0VvUTZwTG9Nb0lONXQ4TkFzbTNwYjNmTk1OVXZHQnA0TzVaaWszZ0xPSEZXQStTaFVWQTBzWW82WXYzcDBJQW9pQ2t1OXFyTnI2RzVMWnZNNSsveUxGd0FnPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1MDg1Njg3CWZpbGU6Zml4dHVyZS5iaW4KalJ5RDU4SEVXNEtPckhPTWw1RGJnWEoxWjBJUXJZUjNZOXBPWEVCb2U2N0tKSHBORUNTM3dVYXRsZjJRN1BRejJTdXNxYlE3N2VwZkRFSEN5L0pLQ0E9PQo=";
    const FIXTURE_DATA: &[u8] = b"terra updater fixture\n";

    #[test]
    fn accepts_a_valid_signature() {
        assert!(verify(FIXTURE_PUBKEY, FIXTURE_DATA, FIXTURE_SIG).is_ok());
    }

    #[test]
    fn rejects_tampered_data() {
        let mut tampered = FIXTURE_DATA.to_vec();
        tampered[0] ^= 0x01;
        assert!(verify(FIXTURE_PUBKEY, &tampered, FIXTURE_SIG).is_err());
    }

    #[test]
    fn rejects_truncated_data() {
        assert!(verify(FIXTURE_PUBKEY, &FIXTURE_DATA[..4], FIXTURE_SIG).is_err());
    }

    #[test]
    fn rejects_a_malformed_signature() {
        assert!(verify(FIXTURE_PUBKEY, FIXTURE_DATA, "not a signature").is_err());
    }

    #[test]
    fn rejects_a_malformed_pubkey() {
        assert!(verify("!!!not base64!!!", FIXTURE_DATA, FIXTURE_SIG).is_err());
    }
}
