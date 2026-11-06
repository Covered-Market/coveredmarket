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
    pub coinbase_tx_id: String,
    pub coinbase_merkle_proof: Vec<String>,
}

impl ProofRef {
    pub fn from_proof(p: &crate::Proof, txid_internal: [u8; 32]) -> Self {
        Self {
            txid_display: crate::btc::display_hex(&txid_internal),
            block_hash: p.block_hash.clone(),
            tx_index: p.tx_index,
            merkle_proof: p.merkle_proof.clone(),
            coinbase_tx_id: p.coinbase_tx_id.clone(),
            coinbase_merkle_proof: p.coinbase_merkle_proof.clone(),
        }
    }

    /// Borsh of the light client's `ProofArgsV2 { tx_id, tx_block_blockhash, tx_index, merkle_proof,
    /// coinbase_tx_id, coinbase_merkle_proof, confirmations }`. `H256` is borsh'd in internal byte
    /// order, i.e. the reverse of the display hex we carry.
    pub fn borsh_args(&self, confirmations: u64) -> Vec<u8> {
        fn h(display: &str) -> [u8; 32] { crate::parse_hash_display(display) }
        let args = ProofArgsV2 {
            tx_id: h(&self.txid_display),
            tx_block_blockhash: h(&self.block_hash),
            tx_index: self.tx_index,
            merkle_proof: self.merkle_proof.iter().map(|x| h(x)).collect(),
            coinbase_tx_id: h(&self.coinbase_tx_id),
            coinbase_merkle_proof: self.coinbase_merkle_proof.iter().map(|x| h(x)).collect(),
            confirmations,
        };
        near_sdk::borsh::to_vec(&args).expect("borsh")
    }
}

/// Mirror of Near-One `btc-types::contract_args::ProofArgsV2` (borsh layout).
#[derive(near_sdk::borsh::BorshSerialize, near_sdk::borsh::BorshDeserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct ProofArgsV2 {
    pub tx_id: [u8; 32],
    pub tx_block_blockhash: [u8; 32],
    pub tx_index: u64,
    pub merkle_proof: Vec<[u8; 32]>,
    pub coinbase_tx_id: [u8; 32],
    pub coinbase_merkle_proof: Vec<[u8; 32]>,
    pub confirmations: u64,
}

/// NEP-145 storage management (registering a payee with the token).
#[ext_contract(ext_storage)]
pub trait StorageManagement {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
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
