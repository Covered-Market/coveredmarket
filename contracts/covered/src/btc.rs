//! Bitcoin side of Covered: scripts, the one-input-one-output settlement
//! transaction, BIP-143 sighash, witness assembly and txids.
//!
//! Everything here is deterministic from contract state. No method takes a
//! caller-supplied sighash, script or amount for a settlement (invariant 4).

use bitcoin::consensus::{deserialize, serialize};
use bitcoin::hashes::Hash;
use bitcoin::secp256k1::ecdsa::Signature as SecpSignature;
use bitcoin::sighash::{EcdsaSighashType, SighashCache};
use bitcoin::{
    absolute::LockTime, transaction::Version, Amount, OutPoint, ScriptBuf, Sequence, Transaction,
    TxIn, TxOut, Txid, Witness, WPubkeyHash,
};
use near_sdk::near;

/// Network the contract was initialised for. Fixed at `new`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Mainnet,
    Testnet4,
    Regtest,
}

impl Network {
    pub fn to_bitcoin(self) -> bitcoin::Network {
        match self {
            Network::Mainnet => bitcoin::Network::Bitcoin,
            Network::Testnet4 => bitcoin::Network::Testnet,
            Network::Regtest => bitcoin::Network::Regtest,
        }
    }
}

/// A specific unspent output on Bitcoin. `txid` is the non-witness txid, in
/// Bitcoin's internal (little-endian) byte order.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Outpoint {
    pub txid: [u8; 32],
    pub vout: u32,
    pub value_sats: u64,
}

/// P2WPKH scriptPubKey for a compressed public key: `OP_0 <hash160(pubkey)>`.
pub fn p2wpkh_script(pubkey33: &[u8; 33]) -> Vec<u8> {
    let pk = bitcoin::PublicKey::from_slice(pubkey33).expect("33-byte compressed key");
    let wpkh: WPubkeyHash = pk.wpubkey_hash().expect("compressed");
    ScriptBuf::new_p2wpkh(&wpkh).to_bytes()
}

/// bech32/bech32m address string for a scriptPubKey on this network.
pub fn address_for_script(script: &[u8], network: Network) -> String {
    let s = ScriptBuf::from_bytes(script.to_vec());
    bitcoin::Address::from_script(&s, network.to_bitcoin())
        .map(|a| a.to_string())
        .unwrap_or_default()
}

/// Parse a bech32 address and return its scriptPubKey if it is a v0 witness
/// program (P2WPKH or P2WSH) for `network`. Anything else is refused.
pub fn script_from_address(addr: &str, network: Network) -> Option<Vec<u8>> {
    let a: bitcoin::Address<bitcoin::address::NetworkUnchecked> = addr.parse().ok()?;
    let a = a.require_network(network.to_bitcoin()).ok()?;
    let s = a.script_pubkey();
    if s.is_p2wpkh() || s.is_p2wsh() {
        Some(s.to_bytes())
    } else {
        None
    }
}

/// Accept only v0 witness scripts of the two shapes we settle to.
pub fn is_allowed_recipient_script(script: &[u8]) -> bool {
    let s = ScriptBuf::from_bytes(script.to_vec());
    s.is_p2wpkh() || s.is_p2wsh()
}

/// The settlement transaction: one input (the collateral), one output.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unsigned {
    pub tx: Transaction,
    /// Non-witness txid in internal byte order (what `confirm_spend` matches).
    pub txid: [u8; 32],
    /// BIP-143 SIGHASH_ALL digest for input 0.
    pub sighash: [u8; 32],
    pub amount_sats: u64,
}

/// Build the deterministic spend of `collateral` to `to_script`.
/// `None` if the output would be dust (should be impossible given `min_size`).
pub fn build_spend(
    collateral: &Outpoint,
    collateral_script: &[u8],
    to_script: &[u8],
    fee_sats: u64,
) -> Option<Unsigned> {
    let amount = collateral.value_sats.checked_sub(fee_sats)?;
    if amount <= 546 {
        return None;
    }
    let tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid: Txid::from_byte_array(collateral.txid),
                vout: collateral.vout,
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::MAX, // no RBF signalling
            witness: Witness::new(),
        }],
        output: vec![TxOut {
            value: Amount::from_sat(amount),
            script_pubkey: ScriptBuf::from_bytes(to_script.to_vec()),
        }],
    };
    let txid = tx.compute_txid().to_byte_array();
    let mut cache = SighashCache::new(&tx);
    let sighash = cache
        .p2wpkh_signature_hash(
            0,
            &ScriptBuf::from_bytes(collateral_script.to_vec()),
            Amount::from_sat(collateral.value_sats),
            EcdsaSighashType::All,
        )
        .ok()?
        .to_byte_array();
    Some(Unsigned { tx, txid, sighash, amount_sats: amount })
}

/// Attach the witness `[DER(sig) || 0x01, pubkey]` and return the raw tx.
/// `sig64` is the compact (r || s) signature, already low-S normalised.
pub fn finalize(unsigned: &Unsigned, sig64: &[u8; 64], pubkey33: &[u8; 33]) -> Vec<u8> {
    let sig = SecpSignature::from_compact(sig64).expect("64-byte compact signature");
    let mut der = sig.serialize_der().to_vec();
    der.push(EcdsaSighashType::All as u8);
    let mut tx = unsigned.tx.clone();
    let mut w = Witness::new();
    w.push(der);
    w.push(pubkey33.to_vec());
    tx.input[0].witness = w;
    serialize(&tx)
}

/// Parse a raw transaction (with or without witness) and return
/// `(txid_internal_order, outputs as (vout, value, script))`.
pub fn parse_tx(raw: &[u8]) -> Option<([u8; 32], Vec<(u32, u64, Vec<u8>)>)> {
    let tx: Transaction = deserialize(raw).ok()?;
    let txid = tx.compute_txid().to_byte_array();
    let outs = tx
        .output
        .iter()
        .enumerate()
        .map(|(i, o)| (i as u32, o.value.to_sat(), o.script_pubkey.to_bytes()))
        .collect();
    Some((txid, outs))
}

/// Verify a Merkle branch: `txid` at `index` with `branch` reaches `root`.
/// All hashes in internal byte order.
pub fn merkle_root_from_branch(txid: [u8; 32], index: u32, branch: &[[u8; 32]]) -> [u8; 32] {
    use bitcoin::hashes::sha256d;
    let mut h = txid;
    let mut idx = index;
    for sib in branch {
        let mut buf = [0u8; 64];
        if idx & 1 == 0 {
            buf[..32].copy_from_slice(&h);
            buf[32..].copy_from_slice(sib);
        } else {
            buf[..32].copy_from_slice(sib);
            buf[32..].copy_from_slice(&h);
        }
        h = sha256d::Hash::hash(&buf).to_byte_array();
        idx >>= 1;
    }
    h
}

/// Hex of a hash in display (big-endian) order, as explorers print it.
pub fn display_hex(internal: &[u8; 32]) -> String {
    let mut v = *internal;
    v.reverse();
    hex::encode(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitcoin::secp256k1::{Message, Secp256k1, SecretKey};

    fn key() -> (SecretKey, [u8; 33]) {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[7u8; 32]).unwrap();
        let pk = bitcoin::PublicKey::new(sk.public_key(&secp));
        let mut b = [0u8; 33];
        b.copy_from_slice(&pk.to_bytes());
        (sk, b)
    }

    #[test]
    fn p2wpkh_script_and_address_round_trip() {
        let (_, pk) = key();
        let script = p2wpkh_script(&pk);
        assert_eq!(script.len(), 22);
        assert_eq!(script[0], 0x00);
        assert_eq!(script[1], 0x14);
        let addr = address_for_script(&script, Network::Regtest);
        assert!(addr.starts_with("bcrt1q"), "{addr}");
        assert_eq!(script_from_address(&addr, Network::Regtest).unwrap(), script);
        assert!(script_from_address(&addr, Network::Mainnet).is_none());
    }

    #[test]
    fn spend_is_deterministic_and_signature_verifies() {
        let (sk, pk) = key();
        let script = p2wpkh_script(&pk);
        let collateral = Outpoint { txid: [0xab; 32], vout: 1, value_sats: 200_000_000 };
        let u1 = build_spend(&collateral, &script, &script, 1_000).unwrap();
        let u2 = build_spend(&collateral, &script, &script, 1_000).unwrap();
        assert_eq!(u1, u2);
        assert_eq!(u1.amount_sats, 199_999_000);
        // sign with secp256k1 and finalize
        let secp = Secp256k1::new();
        let sig = secp.sign_ecdsa(&Message::from_digest(u1.sighash), &sk);
        let raw = finalize(&u1, &sig.serialize_compact(), &pk);
        let tx: Transaction = deserialize(&raw).unwrap();
        assert_eq!(tx.compute_txid().to_byte_array(), u1.txid, "txid is witness-independent");
        // independent verification of the witness against the sighash
        let mut cache = SighashCache::new(&tx);
        let sh = cache
            .p2wpkh_signature_hash(
                0,
                &ScriptBuf::from_bytes(script.clone()),
                Amount::from_sat(collateral.value_sats),
                EcdsaSighashType::All,
            )
            .unwrap();
        let der = &tx.input[0].witness[0];
        let s = SecpSignature::from_der(&der[..der.len() - 1]).unwrap();
        let pk_secp = bitcoin::secp256k1::PublicKey::from_slice(&pk).unwrap();
        secp.verify_ecdsa(&Message::from_digest(sh.to_byte_array()), &s, &pk_secp).unwrap();
    }

    #[test]
    fn dust_and_underflow_refused() {
        let (_, pk) = key();
        let script = p2wpkh_script(&pk);
        let c = Outpoint { txid: [1; 32], vout: 0, value_sats: 1_200 };
        assert!(build_spend(&c, &script, &script, 1_000).is_none());
        let c = Outpoint { txid: [1; 32], vout: 0, value_sats: 500 };
        assert!(build_spend(&c, &script, &script, 1_000).is_none());
    }

    #[test]
    fn bip143_native_p2wpkh_vector() {
        // BIP-143 "Native P2WPKH" example: second input is P2WPKH, value 6 BTC.
        let raw = hex::decode("0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000").unwrap();
        let tx: Transaction = deserialize(&raw).unwrap();
        let pubkey = hex::decode("025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357").unwrap();
        let mut pk = [0u8; 33];
        pk.copy_from_slice(&pubkey);
        let script = p2wpkh_script(&pk);
        assert_eq!(hex::encode(&script), "00141d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
        let mut cache = SighashCache::new(&tx);
        let sh = cache
            .p2wpkh_signature_hash(1, &ScriptBuf::from_bytes(script), Amount::from_sat(600_000_000), EcdsaSighashType::All)
            .unwrap();
        assert_eq!(hex::encode(sh.to_byte_array()), "c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670");
    }

    #[test]
    fn merkle_branch_single_tx_block() {
        let txid = [9u8; 32];
        assert_eq!(merkle_root_from_branch(txid, 0, &[]), txid);
    }
}
