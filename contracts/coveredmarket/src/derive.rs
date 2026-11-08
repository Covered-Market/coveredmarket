//! Chain Signatures key derivation, as the live MPC signer does it:
//! `derived = root + SHA3-256(prefix || predecessor || "," || path) * G`.
//! (SHA3-256, not SHA-256 — confirmed against `v1.signer-prod.testnet`; see the test vector below.)
//!
//! The prefix string is a contract parameter so it can be pinned to whatever
//! the deployed signer version uses (open question 2 in the spec).
//! `Verify` check 2 recomputes exactly this in the browser.

use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::elliptic_curve::PrimeField;
use k256::{AffinePoint, ProjectivePoint, Scalar};
use sha3::{Digest, Sha3_256};

pub const DEFAULT_PREFIX: &str = "near-mpc-recovery v0.1.0 epsilon derivation:";

/// Parse the signer root key, given as `secp256k1:<base58 of 64-byte uncompressed point without 0x04>`
/// or as 33/65-byte hex. Returns the uncompressed 65-byte point.
pub fn parse_root_key(s: &str) -> Option<[u8; 65]> {
    let body = s.strip_prefix("secp256k1:").unwrap_or(s);
    let bytes = if let Ok(h) = hex::decode(body) {
        h
    } else {
        bs58_decode(body)?
    };
    match bytes.len() {
        64 => {
            let mut out = [4u8; 65];
            out[1..].copy_from_slice(&bytes);
            Some(out)
        }
        65 if bytes[0] == 4 => bytes.try_into().ok(),
        33 => {
            let p = k256::PublicKey::from_sec1_bytes(&bytes).ok()?;
            let enc = p.to_encoded_point(false);
            enc.as_bytes().try_into().ok()
        }
        _ => None,
    }
}

pub fn epsilon(prefix: &str, predecessor: &str, path: &str) -> [u8; 32] {
    let mut h = Sha3_256::new();
    h.update(prefix.as_bytes());
    h.update(predecessor.as_bytes());
    h.update(b",");
    h.update(path.as_bytes());
    h.finalize().into()
}

/// Compressed 33-byte derived public key.
pub fn derive_pubkey(root65: &[u8; 65], prefix: &str, predecessor: &str, path: &str) -> Option<[u8; 33]> {
    let root = k256::PublicKey::from_sec1_bytes(root65).ok()?;
    let eps = epsilon(prefix, predecessor, path);
    let scalar: Scalar = Option::from(Scalar::from_repr(eps.into()))?;
    let point: ProjectivePoint = ProjectivePoint::from(*root.as_affine()) + ProjectivePoint::GENERATOR * scalar;
    let affine: AffinePoint = point.to_affine();
    let enc = affine.to_encoded_point(true);
    enc.as_bytes().try_into().ok()
}

/// Verify a 64-byte compact ECDSA signature (r||s) over `digest` with `pubkey33`.
pub fn verify_sig(pubkey33: &[u8; 33], digest: &[u8; 32], sig64: &[u8; 64]) -> bool {
    use k256::ecdsa::signature::hazmat::PrehashVerifier;
    let Ok(vk) = k256::ecdsa::VerifyingKey::from_sec1_bytes(pubkey33) else { return false };
    let Ok(sig) = k256::ecdsa::Signature::from_slice(sig64) else { return false };
    vk.verify_prehash(digest, &sig).is_ok()
}

/// Normalise `s` to the low half of the curve order (BIP-62 / Bitcoin policy).
pub fn normalize_low_s(sig64: &[u8; 64]) -> [u8; 64] {
    let Ok(sig) = k256::ecdsa::Signature::from_slice(sig64) else { return *sig64 };
    let sig = sig.normalize_s().unwrap_or(sig);
    sig.to_bytes().into()
}

fn bs58_decode(s: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut out: Vec<u8> = vec![0];
    for c in s.bytes() {
        let v = ALPHABET.iter().position(|&a| a == c)? as u32;
        let mut carry = v;
        for b in out.iter_mut().rev() {
            let t = (*b as u32) * 58 + carry;
            *b = (t & 0xff) as u8;
            carry = t >> 8;
        }
        while carry > 0 {
            out.insert(0, (carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|&c| c == b'1').count();
    let mut res = vec![0u8; zeros];
    let start = out.iter().position(|&b| b != 0).unwrap_or(out.len());
    res.extend_from_slice(&out[start..]);
    Some(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::elliptic_curve::PrimeField;

    #[test]
    fn derivation_matches_scalar_arithmetic() {
        // root = r*G, derived must equal (r + eps)*G
        let r = Scalar::from_repr([5u8; 32].into()).unwrap();
        let root = (ProjectivePoint::GENERATOR * r).to_affine().to_encoded_point(false);
        let root65: [u8; 65] = root.as_bytes().try_into().unwrap();
        let d = derive_pubkey(&root65, DEFAULT_PREFIX, "coveredmarket.near", "astrid.near/CV-37").unwrap();
        let eps = Scalar::from_repr(epsilon(DEFAULT_PREFIX, "coveredmarket.near", "astrid.near/CV-37").into()).unwrap();
        let expect = (ProjectivePoint::GENERATOR * (r + eps)).to_affine().to_encoded_point(true);
        assert_eq!(&d[..], expect.as_bytes());
        // a different predecessor (A1: the operator) gives a different key
        let d2 = derive_pubkey(&root65, DEFAULT_PREFIX, "coveredmarket-ops.near", "astrid.near/CV-37").unwrap();
        assert_ne!(d, d2);
    }

    /// Recorded from the live testnet signer (v1.signer-prod.testnet, 5 Nov 2026):
    /// `derived_public_key { path: "probe/CV-1", predecessor: "covered-probe.testnet", domain_id: 0 }`.
    #[test]
    fn matches_live_testnet_signer() {
        let root = parse_root_key("secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3").unwrap();
        let want = parse_root_key("secp256k1:5g57Q1tvBYESE2hT4BD9dP7X7uUri9LA5XYuhMZG1LjPH73MrMnyMZhAsaXtonLXwc2TCYkAgdBj4kZNmKXK9s7M").unwrap();
        let got = derive_pubkey(&root, DEFAULT_PREFIX, "covered-probe.testnet", "probe/CV-1").unwrap();
        let want_c = k256::PublicKey::from_sec1_bytes(&want).unwrap().to_encoded_point(true);
        assert_eq!(&got[..], want_c.as_bytes());
    }

    #[test]
    fn root_key_formats() {
        let r = Scalar::from_repr([5u8; 32].into()).unwrap();
        let p = (ProjectivePoint::GENERATOR * r).to_affine();
        let unc = p.to_encoded_point(false);
        let hex65 = hex::encode(unc.as_bytes());
        let hex33 = hex::encode(p.to_encoded_point(true).as_bytes());
        assert_eq!(parse_root_key(&hex65).unwrap()[..], unc.as_bytes()[..]);
        assert_eq!(parse_root_key(&hex33).unwrap()[..], unc.as_bytes()[..]);
        assert_eq!(bs58_decode("1112").unwrap(), vec![0, 0, 0, 1]);
    }

    #[test]
    fn sig_verify_and_low_s() {
        use k256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey};
        let sk = SigningKey::from_bytes(&[3u8; 32].into()).unwrap();
        let pk: [u8; 33] = sk.verifying_key().to_encoded_point(true).as_bytes().try_into().unwrap();
        let digest = [0x42u8; 32];
        let sig: k256::ecdsa::Signature = sk.sign_prehash(&digest).unwrap();
        let bytes: [u8; 64] = sig.to_bytes().into();
        assert!(verify_sig(&pk, &digest, &bytes));
        assert!(!verify_sig(&pk, &[0u8; 32], &bytes));
        assert!(verify_sig(&pk, &digest, &normalize_low_s(&bytes)));
    }
}
