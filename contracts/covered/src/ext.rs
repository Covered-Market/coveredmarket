//! External interfaces: the Bitcoin light client, the Chain Signatures signer
//! and NEP-141. Shapes are pinned here and nowhere else (spec, open questions 1–2).

use near_sdk::json_types::U128;
use near_sdk::{ext_contract, near, AccountId};

/// Pass-through proof reference, stored with the offer so the collateral's
/// depth can be re-checked at exercise without the caller resupplying it.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct ProofRef {
    /// Display-order hex, as the light client expects.
    pub txid_display: String,
    pub block_hash: String,
    pub tx_index: u64,
    pub merkle_proof: Vec<String>,
}

impl ProofRef {
    pub fn from_proof(p: &crate::Proof, txid_internal: [u8; 32]) -> Self {
        Self {
            txid_display: crate::btc::display_hex(&txid_internal),
            block_hash: p.block_hash.clone(),
            tx_index: p.tx_index,
            merkle_proof: p.merkle_proof.clone(),
        }
    }
}

/// Near-One `btc-light-client-contract` inclusion check (argument names follow
/// its `btc-types`; the exact method of the pinned revision is confirmed on day 1).
#[ext_contract(ext_btc_client)]
pub trait BtcClient {
    fn verify_transaction_inclusion(
        &self,
        tx_id: String,
        tx_block_blockhash: String,
        tx_index: u64,
        merkle_proof: Vec<String>,
        confirmations: u64,
    ) -> bool;
}

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// What `v1.signer` returns from `sign`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignatureResponse {
    pub big_r: BigR,
    pub s: Scalar,
    pub recovery_id: u8,
}
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BigR {
    pub affine_point: String,
}
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Scalar {
    pub scalar: String,
}

impl SignatureResponse {
    /// Compact (r || s). `affine_point` is a 33-byte compressed point; r is its x.
    pub fn compact(&self) -> Option<[u8; 64]> {
        let r = hex::decode(&self.big_r.affine_point).ok()?;
        let s = hex::decode(&self.s.scalar).ok()?;
        let rx: &[u8] = match r.len() {
            33 => &r[1..],
            32 => &r[..],
            _ => return None,
        };
        if s.len() != 32 {
            return None;
        }
        let mut out = [0u8; 64];
        out[..32].copy_from_slice(rx);
        out[32..].copy_from_slice(&s);
        Some(out)
    }
}

/// Signer `sign` arguments, two formats (spec open question 2).
pub fn sign_args(format: u8, path: &str, sighash: &[u8; 32]) -> Vec<u8> {
    let v = if format == 1 {
        serde_json::json!({ "request": { "payload": sighash.to_vec(), "path": path, "key_version": 0 } })
    } else {
        serde_json::json!({ "request": { "payload_v2": { "Ecdsa": hex::encode(sighash) }, "path": path, "domain_id": 0 } })
    };
    serde_json::to_vec(&v).unwrap()
}

/// Borsh/JSON-friendly byte vector for callback arguments.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Bytes(pub Vec<u8>);

impl From<bitcoin::Transaction> for Bytes {
    fn from(tx: bitcoin::Transaction) -> Self {
        Bytes(bitcoin::consensus::serialize(&tx))
    }
}
