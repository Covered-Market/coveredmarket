//! L1 stand-in for `v1.signer`: same interface, a known root scalar, and
//! switches to fail or delay the next request. Never deploy outside a sandbox.
use k256::ecdsa::signature::hazmat::PrehashSigner;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::elliptic_curve::PrimeField;
use k256::{ProjectivePoint, Scalar};
use near_sdk::{env, near, PanicOnDefault};
use sha3::{Digest, Sha3_256};

const PREFIX: &str = "near-mpc-recovery v0.1.0 epsilon derivation:";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockSigner { root: [u8; 32], fail_next: u32, wrong_key_next: u32, calls: u64 }

#[near]
impl MockSigner {
    #[init]
    pub fn new(root_scalar_hex: String) -> Self {
        let v = hex::decode(root_scalar_hex).unwrap();
        Self { root: v.try_into().unwrap(), fail_next: 0, wrong_key_next: 0, calls: 0 }
    }
    pub fn public_key(&self) -> String {
        let r = Scalar::from_repr(self.root.into()).unwrap();
        format!("secp256k1-hex:{}", hex::encode((ProjectivePoint::GENERATOR * r).to_affine().to_encoded_point(false).as_bytes()))
    }
    pub fn root_key_hex(&self) -> String {
        let r = Scalar::from_repr(self.root.into()).unwrap();
        hex::encode((ProjectivePoint::GENERATOR * r).to_affine().to_encoded_point(false).as_bytes())
    }
    /// Makes `sign` panic until cleared (a panic reverts the counter, so this is sticky; clear with 0).
    pub fn set_fail_next(&mut self, n: u32) { self.fail_next = n; }
    pub fn set_wrong_key_next(&mut self, n: u32) { self.wrong_key_next = n; }
    pub fn calls(&self) -> u64 { self.calls }
    pub fn derived_public_key(&self, path: String, predecessor: Option<near_sdk::AccountId>) -> String {
        let pred = predecessor.unwrap_or_else(env::predecessor_account_id);
        hex::encode(self.derive(pred.as_str(), &path).verifying_key().to_encoded_point(true).as_bytes())
    }
    #[payable]
    pub fn sign(&mut self, request: serde_json::Value) -> serde_json::Value {
        self.calls += 1;
        if self.fail_next > 0 { self.fail_next -= 1; env::panic_str("mock signer: failing on purpose"); }
        let path = request["path"].as_str().expect("path");
        let payload: [u8; 32] = if let Some(h) = request["payload_v2"]["Ecdsa"].as_str() {
            hex::decode(h).unwrap().try_into().unwrap()
        } else {
            let arr = request["payload"].as_array().expect("payload");
            let v: Vec<u8> = arr.iter().map(|x| x.as_u64().unwrap() as u8).collect();
            v.try_into().unwrap()
        };
        let mut sk = self.derive(env::predecessor_account_id().as_str(), path);
        if self.wrong_key_next > 0 {
            self.wrong_key_next -= 1;
            sk = self.derive("someone-else.test", path);
        }
        let sig: k256::ecdsa::Signature = sk.sign_prehash(&payload).unwrap();
        let b: [u8; 64] = sig.to_bytes().into();
        serde_json::json!({ "big_r": { "affine_point": format!("02{}", hex::encode(&b[..32])) }, "s": { "scalar": hex::encode(&b[32..]) }, "recovery_id": 0 })
    }
}

impl MockSigner {
    fn derive(&self, pred: &str, path: &str) -> k256::ecdsa::SigningKey {
        let mut h = Sha3_256::new();
        h.update(PREFIX.as_bytes()); h.update(pred.as_bytes()); h.update(b","); h.update(path.as_bytes());
        let eps = Scalar::from_repr(h.finalize()).unwrap();
        let r = Scalar::from_repr(self.root.into()).unwrap();
        k256::ecdsa::SigningKey::from_bytes(&(r + eps).to_bytes()).unwrap()
    }
}
