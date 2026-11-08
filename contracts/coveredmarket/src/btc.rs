//! Bitcoin side of CoveredMarket: the deposit script, the one-input-one-output settlement
//! transaction, BIP-143 sighash, witness assembly and txids.
//!
//! The deposit address is P2WSH of
//!     OP_IF <mpc_key> OP_CHECKSIG
//!     OP_ELSE <unlock_s> OP_CHECKLOCKTIMEVERIFY OP_DROP <rescue_key> OP_CHECKSIG OP_ENDIF
//! Normally only the first branch is used: the contract has the MPC sign its committed settlement.
//! The second is the seller's exit if NEAR or the signing network ever stops: after `unlock_s`
//! (expiry + grace + rescue delay, fixed per offer) the seller's own rescue key can sweep the coins
//! without NEAR.
//!
//! Everything here is deterministic from contract state. No method takes a
//! caller-supplied sighash, script or amount for a settlement (invariant 4).

use bitcoin::consensus::{deserialize, serialize};
use bitcoin::hashes::Hash;
use bitcoin::secp256k1::ecdsa::Signature as SecpSignature;
use bitcoin::sighash::{EcdsaSighashType, SighashCache};
use bitcoin::blockdata::opcodes::all::{OP_CHECKSIG, OP_CLTV, OP_DROP, OP_ELSE, OP_ENDIF, OP_IF};
use bitcoin::blockdata::script::{Builder, PushBytesBuf};
use bitcoin::{
    absolute::LockTime, transaction::Version, Amount, OutPoint, Script, ScriptBuf, Sequence, Transaction,
    TxIn, TxOut, Txid, WScriptHash, Witness, WPubkeyHash,
};

/// Smallest absolute lock time Bitcoin reads as a timestamp rather than a block height.
pub const LOCKTIME_THRESHOLD: u64 = 500_000_000;

/// The deposit witness script (see the module doc). `unlock_s` is a Unix time (>= 500,000,000).
pub fn deposit_witness_script(mpc33: &[u8; 33], rescue33: &[u8; 33], unlock_s: u64) -> Vec<u8> {
    let push = |b: &[u8; 33]| PushBytesBuf::try_from(b.to_vec()).expect("33 bytes");
    Builder::new()
        .push_opcode(OP_IF)
        .push_slice(push(mpc33))
        .push_opcode(OP_CHECKSIG)
        .push_opcode(OP_ELSE)
        .push_int(unlock_s as i64)
        .push_opcode(OP_CLTV)
        .push_opcode(OP_DROP)
        .push_slice(push(rescue33))
        .push_opcode(OP_CHECKSIG)
        .push_opcode(OP_ENDIF)
        .into_script()
        .into_bytes()
}

/// P2WSH scriptPubKey: `OP_0 <sha256(witness_script)>`.
pub fn p2wsh_script(witness_script: &[u8]) -> Vec<u8> {
    ScriptBuf::new_p2wsh(&WScriptHash::hash(witness_script)).into_bytes()
}
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

/// Build the deterministic MPC-branch spend of `collateral` (locked by `witness_script`) to `to_script`.
/// Signals replace-by-fee so a stuck settlement can be re-signed with a higher fee (same input, same
/// recipient). `None` if the output would be dust.
pub fn build_spend(
    collateral: &Outpoint,
    witness_script: &[u8],
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
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
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
        .p2wsh_signature_hash(0, Script::from_bytes(witness_script), Amount::from_sat(collateral.value_sats), EcdsaSighashType::All)
        .ok()?
        .to_byte_array();
    Some(Unsigned { tx, txid, sighash, amount_sats: amount })
}

/// Attach the MPC-branch witness `[DER(sig) || 0x01, 0x01, witness_script]` and return the raw tx.
/// `sig64` is the compact (r || s) signature, already low-S normalised.
pub fn finalize(unsigned: &Unsigned, sig64: &[u8; 64], witness_script: &[u8]) -> Vec<u8> {
    let sig = SecpSignature::from_compact(sig64).expect("64-byte compact signature");
    let mut der = sig.serialize_der().to_vec();
    der.push(EcdsaSighashType::All as u8);
    let mut tx = unsigned.tx.clone();
    let mut w = Witness::new();
    w.push(der);
    w.push([1u8]); // OP_IF branch: the MPC key
    w.push(witness_script);
    tx.input[0].witness = w;
    serialize(&tx)
}

/// The seller's exit (OP_ELSE branch): spend `collateral` to `to_script` with the rescue key, valid only
/// once Bitcoin's median time past reaches `unlock_s`. Returns the unsigned tx and its sighash; the
/// witness is `[DER(sig) || 0x01, <empty>, witness_script]` (see `finalize_rescue`). Reference for
/// `scripts/rescue.ts`; the contract never builds this.
pub fn build_rescue(collateral: &Outpoint, witness_script: &[u8], to_script: &[u8], fee_sats: u64, unlock_s: u64) -> Option<Unsigned> {
    let amount = collateral.value_sats.checked_sub(fee_sats)?;
    if amount <= 546 || unlock_s < LOCKTIME_THRESHOLD {
        return None;
    }
    let tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::from_consensus(u32::try_from(unlock_s).ok()?),
        input: vec![TxIn {
            previous_output: OutPoint { txid: Txid::from_byte_array(collateral.txid), vout: collateral.vout },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME, // < 0xffffffff so nLockTime is enforced
            witness: Witness::new(),
        }],
        output: vec![TxOut { value: Amount::from_sat(amount), script_pubkey: ScriptBuf::from_bytes(to_script.to_vec()) }],
    };
    let txid = tx.compute_txid().to_byte_array();
    let sighash = SighashCache::new(&tx)
        .p2wsh_signature_hash(0, Script::from_bytes(witness_script), Amount::from_sat(collateral.value_sats), EcdsaSighashType::All)
        .ok()?
        .to_byte_array();
    Some(Unsigned { tx, txid, sighash, amount_sats: amount })
}

pub fn finalize_rescue(unsigned: &Unsigned, sig64: &[u8; 64], witness_script: &[u8]) -> Vec<u8> {
    let sig = SecpSignature::from_compact(sig64).expect("64-byte compact signature");
    let mut der = sig.serialize_der().to_vec();
    der.push(EcdsaSighashType::All as u8);
    let mut tx = unsigned.tx.clone();
    let mut w = Witness::new();
    w.push(der);
    w.push([] as [u8; 0]); // OP_ELSE branch: the rescue key
    w.push(witness_script);
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

    #[allow(dead_code)]
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

    fn key_n(n: u8) -> (SecretKey, [u8; 33]) {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[n; 32]).unwrap();
        (sk, bitcoin::PublicKey::new(sk.public_key(&secp)).to_bytes().try_into().unwrap())
    }
    const UNLOCK: u64 = 1_800_100_000;

    /// Check a spend of `prev_script` with Bitcoin Core's own interpreter (libbitcoinconsensus, all flags).
    fn consensus_ok(raw: &[u8], prev_script: &[u8], value: u64) -> bool {
        bitcoinconsensus::verify(prev_script, value, raw, None, 0).is_ok()
    }

    #[test]
    fn mpc_branch_spend_passes_bitcoin_consensus() {
        let (mpc_sk, mpc) = key_n(7);
        let (_, rescue) = key_n(8);
        let ws = deposit_witness_script(&mpc, &rescue, UNLOCK);
        let spk = p2wsh_script(&ws);
        assert_eq!(spk.len(), 34);
        assert!(address_for_script(&spk, Network::Regtest).starts_with("bcrt1q"));
        let collateral = Outpoint { txid: [0xab; 32], vout: 1, value_sats: 200_000_000 };
        let to = p2wpkh_script(&key_n(9).1);
        let u1 = build_spend(&collateral, &ws, &to, 1_000).unwrap();
        assert_eq!(u1, build_spend(&collateral, &ws, &to, 1_000).unwrap(), "deterministic");
        assert_eq!(u1.amount_sats, 199_999_000);
        let secp = Secp256k1::new();
        let sig = secp.sign_ecdsa(&Message::from_digest(u1.sighash), &mpc_sk).serialize_compact();
        let raw = finalize(&u1, &sig, &ws);
        let tx: Transaction = deserialize(&raw).unwrap();
        assert_eq!(tx.compute_txid().to_byte_array(), u1.txid, "txid is witness-independent");
        assert!(tx.input[0].sequence.is_rbf(), "signals replace-by-fee");
        assert!(consensus_ok(&raw, &spk, collateral.value_sats), "MPC branch must satisfy Bitcoin's script rules");
        // a different fee is a different tx paying the same recipient from the same coin
        let u2 = build_spend(&collateral, &ws, &to, 2_000).unwrap();
        assert_ne!(u1.txid, u2.txid);
        assert_eq!(u2.tx.output[0].script_pubkey, u1.tx.output[0].script_pubkey);
        assert_eq!(u2.tx.input[0].previous_output, u1.tx.input[0].previous_output);
        // the wrong key fails
        let (other, _) = key_n(5);
        let bad = finalize(&u1, &secp.sign_ecdsa(&Message::from_digest(u1.sighash), &other).serialize_compact(), &ws);
        assert!(!consensus_ok(&bad, &spk, collateral.value_sats));
    }

    #[test]
    fn rescue_branch_needs_the_rescue_key_and_the_unlock_time() {
        let (mpc_sk, mpc) = key_n(7);
        let (rescue_sk, rescue) = key_n(8);
        let ws = deposit_witness_script(&mpc, &rescue, UNLOCK);
        let spk = p2wsh_script(&ws);
        let collateral = Outpoint { txid: [0xcd; 32], vout: 0, value_sats: 1_000_000 };
        let to = p2wpkh_script(&rescue);
        let secp = Secp256k1::new();
        let u = build_rescue(&collateral, &ws, &to, 500, UNLOCK).unwrap();
        let raw = finalize_rescue(&u, &secp.sign_ecdsa(&Message::from_digest(u.sighash), &rescue_sk).serialize_compact(), &ws);
        assert!(consensus_ok(&raw, &spk, collateral.value_sats), "rescue branch valid at the unlock time");
        // the MPC key cannot use the rescue branch
        let raw = finalize_rescue(&u, &secp.sign_ecdsa(&Message::from_digest(u.sighash), &mpc_sk).serialize_compact(), &ws);
        assert!(!consensus_ok(&raw, &spk, collateral.value_sats));
        // a lock time before the unlock time fails CHECKLOCKTIMEVERIFY
        let early = build_rescue(&collateral, &ws, &to, 500, UNLOCK - 1).unwrap();
        let raw = finalize_rescue(&early, &secp.sign_ecdsa(&Message::from_digest(early.sighash), &rescue_sk).serialize_compact(), &ws);
        assert!(!consensus_ok(&raw, &spk, collateral.value_sats), "before unlock the seller cannot exit alone");
        // and the rescue key cannot use the MPC branch
        let m = build_spend(&collateral, &ws, &to, 500).unwrap();
        let raw = finalize(&m, &secp.sign_ecdsa(&Message::from_digest(m.sighash), &rescue_sk).serialize_compact(), &ws);
        assert!(!consensus_ok(&raw, &spk, collateral.value_sats));
    }

    #[test]
    fn dust_and_underflow_refused() {
        let ws = deposit_witness_script(&key_n(7).1, &key_n(8).1, UNLOCK);
        let script = p2wpkh_script(&key_n(9).1);
        let c = Outpoint { txid: [1; 32], vout: 0, value_sats: 1_200 };
        assert!(build_spend(&c, &ws, &script, 1_000).is_none());
        let c = Outpoint { txid: [1; 32], vout: 0, value_sats: 500 };
        assert!(build_spend(&c, &ws, &script, 1_000).is_none());
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
