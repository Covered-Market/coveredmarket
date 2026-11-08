//! L1: NEAR sandbox with mock signer, mock light client and a stock NEP-141.
//! Requires: `cargo near build` of the three contracts (wasm32 target) and the
//! near-sandbox binary (downloaded by near-workspaces from S3, or set
//! NEAR_SANDBOX_BIN_PATH). Run: `make e2e`.
//!
//! Bitcoin regtest is not required for this file: the light client is mocked
//! and the signed transaction is validated with the `bitcoin` crate. The
//! regtest step (broadcast + mine + gettxoutproof) lives in scripts/regtest.sh.

use anyhow::Result;
use bitcoin::consensus::deserialize;
use bitcoin::hashes::Hash;
use near_sdk::json_types::{U128, U64};
use near_workspaces::{types::NearToken, Account, Contract, Worker};
use near_workspaces::network::Sandbox;
use serde_json::json;

const ROOT_SCALAR_HEX: &str = "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b";
const DAY: u64 = 86_400;

fn wasm(name: &str) -> Vec<u8> {
    let name = name.replace('-', "_"); // cargo-near uses the crate's snake_case name
    let p = format!("{}/../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|_| panic!("build first: cargo near build (missing {p})"))
}

struct Env {
    worker: Worker<Sandbox>,
    coveredmarket: Contract,
    signer: Contract,
    lc: Contract,
    usdc: Contract,
    seller: Account,
    buyer: Account,
    anyone: Account,
}

async fn setup() -> Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let signer = worker.dev_deploy(&wasm("mock-signer")).await?;
    signer.call("new").args_json(json!({ "root_scalar_hex": ROOT_SCALAR_HEX })).transact().await?.into_result()?;
    let root: String = signer.view("root_key_hex").await?.json()?;
    let lc = worker.dev_deploy(&wasm("mock-btc-client")).await?;
    lc.call("new").transact().await?.into_result()?;
    // stock NEP-141 from near-workspaces test assets or a vendored fungible token wasm
    let usdc = worker.dev_deploy(&wasm("mock-usdc")).await?;
    usdc.call("new").transact().await?.into_result()?;
    let coveredmarket = worker.dev_deploy(&wasm("coveredmarket")).await?;
    // The same reviewed parameter file the local stack deploys with (params/local.json), plus accounts.
    let mut params: serde_json::Value = serde_json::from_str(include_str!("../../params/local.json"))?;
    let p = params.as_object_mut().unwrap();
    p.remove("_comment");
    p.insert("signer".into(), json!(signer.id()));
    p.insert("light_client".into(), json!(lc.id()));
    p.insert("usdc".into(), json!(usdc.id()));
    p.insert("mpc_root_key".into(), json!(root));
    p.insert("escrow_timeout_s".into(), json!(7 * DAY));
    coveredmarket.call("new").args_json(json!({ "params": params })).transact().await?.into_result()?;
    let seller = worker.dev_create_account().await?;
    let buyer = worker.dev_create_account().await?;
    let anyone = worker.dev_create_account().await?;
    for a in [&seller, &buyer] {
        a.call(usdc.id(), "storage_deposit").args_json(json!({})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    }
    coveredmarket.as_account().call(usdc.id(), "storage_deposit").args_json(json!({})).deposit(NearToken::from_millinear(10)).transact().await?.into_result()?;
    usdc.call("mint").args_json(json!({ "account_id": buyer.id(), "amount": "500000000000" })).transact().await?.into_result()?;
    Ok(Env { worker, coveredmarket, signer, lc, usdc, seller, buyer, anyone })
}

/// A valid regtest P2WPKH address from a deterministic secret key (test wallets).
fn addr_from_secret(b: u8) -> String {
    let secp = bitcoin::secp256k1::Secp256k1::new();
    let sk = bitcoin::secp256k1::SecretKey::from_slice(&[b; 32]).unwrap();
    let pk: [u8; 33] = sk.public_key(&secp).serialize();
    coveredmarket::btc::address_for_script(&coveredmarket::btc::p2wpkh_script(&pk), coveredmarket::btc::Network::Regtest)
}

/// The seller's rescue key (test wallet `b`), compressed hex.
fn rescue_hex(b: u8) -> String {
    let secp = bitcoin::secp256k1::Secp256k1::new();
    hex::encode(bitcoin::secp256k1::SecretKey::from_slice(&[b; 32]).unwrap().public_key(&secp).serialize())
}

/// Bitcoin Core's own script interpreter must accept `raw` as a spend of the offer's deposit output.
fn assert_valid_spend(view: &serde_json::Value, raw: &[u8]) {
    let spk = coveredmarket::btc::script_from_address(view["address"].as_str().unwrap(), coveredmarket::btc::Network::Regtest).unwrap();
    let value: u64 = view["collateral_value_sats"].as_str().unwrap().parse().unwrap();
    bitcoinconsensus::verify(&spk, value, raw, None, 0).expect("settlement must satisfy Bitcoin's script rules");
}

/// Next expiry on the sandbox grid (whole minutes) at least `lead` seconds ahead.
fn next_expiry(now_s: u64, lead: u64) -> u64 {
    ((now_s + lead) / 60 + 1) * 60
}

async fn now_s(w: &Worker<Sandbox>) -> Result<u64> {
    Ok(w.view_block().await?.timestamp() / 1_000_000_000)
}

/// Fake deposit transaction paying `value` to `script`.
fn deposit_tx(script: &[u8], value: u64) -> (String, String) {
    let tx = bitcoin::Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: bitcoin::absolute::LockTime::ZERO,
        input: vec![bitcoin::TxIn { previous_output: bitcoin::OutPoint { txid: bitcoin::Txid::from_byte_array([1; 32]), vout: 0 }, script_sig: bitcoin::ScriptBuf::new(), sequence: bitcoin::Sequence::MAX, witness: bitcoin::Witness::new() }],
        output: vec![bitcoin::TxOut { value: bitcoin::Amount::from_sat(value), script_pubkey: bitcoin::ScriptBuf::from_bytes(script.to_vec()) }],
    };
    (hex::encode(bitcoin::consensus::serialize(&tx)), tx.compute_txid().to_string())
}

async fn create_and_fund(e: &Env, size: u64, strike: u128, premium: u128) -> Result<u64> {
    create_and_fund_as(e, &e.seller, size, strike, premium).await
}

async fn create_and_fund_as(e: &Env, seller: &Account, size: u64, strike: u128, premium: u128) -> Result<u64> {
    let now = now_s(&e.worker).await?;
    let refund = addr_from_secret(9);
    let serial: u64 = seller.call(e.coveredmarket.id(), "create_offer")
        .args_json(json!({ "terms": { "size_sats": U64(size), "strike_units": U128(strike), "premium_units": U128(premium), "expiry_s": U64(next_expiry(now, 120)), "refund_address": refund, "rescue_pubkey": rescue_hex(11) }}))
        .deposit(NearToken::from_millinear(100)).transact().await?.json()?;
    let view: serde_json::Value = e.coveredmarket.view("get_offer").args_json(json!({ "serial": serial })).await?.json()?;
    let script = coveredmarket::btc::script_from_address(view["address"].as_str().unwrap(), coveredmarket::btc::Network::Regtest).unwrap();
    let (raw, txid) = deposit_tx(&script, size);
    let block = "00".repeat(32);
    e.lc.call("set_included").args_json(json!({ "tx_id": txid, "block_hash": block, "depth": 6 })).transact().await?.into_result()?;
    let ok: bool = e.anyone.call(e.coveredmarket.id(), "confirm_deposit")
        .args_json(json!({ "serial": serial, "proof": { "tx_raw": raw, "block_hash": block, "tx_index": 0, "merkle_proof": [], "coinbase_tx_id": "00".repeat(32), "coinbase_merkle_proof": [] }}))
        .max_gas().transact().await?.json()?;
    assert!(ok);
    let view: serde_json::Value = e.coveredmarket.view("get_offer").args_json(json!({ "serial": serial })).await?.json()?;
    assert_eq!(view["state"], "Funded");
    Ok(serial)
}

async fn buy(e: &Env, serial: u64, amount: u128) -> Result<()> {
    let buyer_addr = addr_from_secret(10);
    e.buyer.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.coveredmarket.id(), "amount": amount.to_string(), "msg": json!({ "serial": serial, "btc_address": buyer_addr }).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    Ok(())
}

async fn state(e: &Env, serial: u64) -> Result<serde_json::Value> {
    Ok(e.coveredmarket.view("get_offer").args_json(json!({ "serial": serial })).await?.json()?)
}

async fn fast_forward_to(e: &Env, t: u64) -> Result<()> {
    // fast_forward(n) advances n blocks; block time is not exactly 1 s, so loop until the chain clock passes `t`
    for _ in 0..20 {
        let now = now_s(&e.worker).await?;
        if now >= t { return Ok(()); }
        e.worker.fast_forward((t - now).max(5)).await?;
    }
    anyhow::bail!("could not fast-forward to {t}")
}

#[tokio::test]
async fn flow_kept() -> Result<()> {
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    buy(&e, s, 6_000_000_000).await?;
    let v = state(&e, s).await?;
    assert_eq!(v["state"], "Sold");
    let claimable: U128 = e.coveredmarket.view("get_claimable").args_json(json!({ "account": e.seller.id() })).await?.json()?;
    assert_eq!(claimable.0, 6_000_000_000);
    let expiry = v["expiry_s"].as_str().unwrap().parse::<u64>()?;
    // settle too early is refused
    let r = e.anyone.call(e.coveredmarket.id(), "settle").args_json(json!({ "serial": s })).max_gas().transact().await?;
    assert!(r.is_failure());
    // (sandbox grace is 7200 s; fast-forward in blocks ≈ seconds)
    fast_forward_to(&e, expiry + 600).await?;
    // mock signer answers with the wrong key once: signature rejected, stays Committed with retry
    e.signer.call("set_wrong_key_next").args_json(json!({ "n": 1 })).transact().await?.into_result()?;
    e.anyone.call(e.coveredmarket.id(), "settle").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    assert_eq!(state(&e, s).await?["state"], "Committed");
    let sighash1 = state(&e, s).await?["commitment_sighash"].clone();
    fast_forward_to(&e, expiry + 600 + 700).await?;
    e.anyone.call(e.coveredmarket.id(), "request_signature").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    let v = state(&e, s).await?;
    assert_eq!(v["state"], "Signed");
    assert_eq!(v["commitment_sighash"], sighash1, "retry used the same sighash");
    // the signed tx is a valid one-in-one-out spend to the refund script
    let raw = hex::decode(v["signed_tx"].as_str().unwrap())?;
    let tx: bitcoin::Transaction = deserialize(&raw)?;
    assert_eq!(tx.input.len(), 1);
    assert_eq!(tx.output.len(), 1);
    assert_eq!(tx.output[0].value.to_sat(), 200_000_000 - 1_000);
    assert_eq!(tx.compute_txid().to_string(), v["commitment_txid"].as_str().unwrap());
    assert_valid_spend(&v, &raw);
    // confirm the spend
    let block = "11".repeat(32);
    e.lc.call("set_included").args_json(json!({ "tx_id": tx.compute_txid().to_string(), "block_hash": block, "depth": 1 })).transact().await?.into_result()?;
    e.anyone.call(e.coveredmarket.id(), "confirm_spend")
        .args_json(json!({ "serial": s, "proof": { "tx_raw": hex::encode(&raw), "block_hash": block, "tx_index": 0, "merkle_proof": [], "coinbase_tx_id": "00".repeat(32), "coinbase_merkle_proof": [] }}))
        .max_gas().transact().await?.into_result()?;
    assert_eq!(state(&e, s).await?["state"], "Kept");
    // seller claims real tokens
    e.seller.call(e.coveredmarket.id(), "claim").max_gas().transact().await?.into_result()?;
    let bal: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.seller.id() })).await?.json()?;
    assert_eq!(bal.0, 6_000_000_000);
    // accounting invariant
    let acc: serde_json::Value = e.coveredmarket.view("get_accounting").await?.json()?;
    let cbal: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.coveredmarket.id() })).await?.json()?;
    assert_eq!(acc["claimable_total"].as_str().unwrap().parse::<u128>()? + acc["escrow_total"].as_str().unwrap().parse::<u128>()?, cbal.0);
    Ok(())
}

#[tokio::test]
async fn flow_exercised_with_escrow() -> Result<()> {
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    buy(&e, s, 6_000_000_000).await?;
    let expiry = state(&e, s).await?["expiry_s"].as_str().unwrap().parse::<u64>()?;
    fast_forward_to(&e, expiry + 5).await?;
    let before: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.buyer.id() })).await?.json()?;
    e.buyer.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.coveredmarket.id(), "amount": "300000000007", "msg": json!({ "serial": s, "exercise": true }).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let v = state(&e, s).await?;
    assert_eq!(v["state"], "Committed", "depth ok → committed; signature is a separate transaction");
    assert_eq!(v["commitment_reason"], "Exercise");
    e.anyone.call(e.coveredmarket.id(), "request_signature").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    let v = state(&e, s).await?;
    assert_eq!(v["state"], "Signed");
    let after: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.buyer.id() })).await?.json()?;
    assert_eq!(before.0 - after.0, 300_000_000_000, "excess 7 units refunded by the token contract");
    let acc: serde_json::Value = e.coveredmarket.view("get_accounting").await?.json()?;
    assert_eq!(acc["escrow_total"], "300000000000");
    // reclaim before timeout refused
    assert!(e.buyer.call(e.coveredmarket.id(), "reclaim_strike").args_json(json!({ "serial": s })).transact().await?.is_failure());
    // confirm delivery → escrow to seller
    let raw = hex::decode(v["signed_tx"].as_str().unwrap())?;
    let tx: bitcoin::Transaction = deserialize(&raw)?;
    assert_valid_spend(&v, &raw);
    let block = "22".repeat(32);
    e.lc.call("set_included").args_json(json!({ "tx_id": tx.compute_txid().to_string(), "block_hash": block, "depth": 1 })).transact().await?.into_result()?;
    e.anyone.call(e.coveredmarket.id(), "confirm_spend")
        .args_json(json!({ "serial": s, "proof": { "tx_raw": hex::encode(&raw), "block_hash": block, "tx_index": 0, "merkle_proof": [], "coinbase_tx_id": "00".repeat(32), "coinbase_merkle_proof": [] }}))
        .max_gas().transact().await?.into_result()?;
    assert_eq!(state(&e, s).await?["state"], "Exercised");
    let claimable: U128 = e.coveredmarket.view("get_claimable").args_json(json!({ "account": e.seller.id() })).await?.json()?;
    assert_eq!(claimable.0, 306_000_000_000);
    Ok(())
}

#[tokio::test]
async fn exercise_refused_when_collateral_depth_fails() -> Result<()> {
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    buy(&e, s, 6_000_000_000).await?;
    let expiry = state(&e, s).await?["expiry_s"].as_str().unwrap().parse::<u64>()?;
    fast_forward_to(&e, expiry + 5).await?;
    e.lc.call("set_stale").args_json(json!({ "stale": true })).transact().await?.into_result()?;
    let before: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.buyer.id() })).await?.json()?;
    e.buyer.call(e.usdc.id(), "ft_transfer_call")
        .args_json(json!({ "receiver_id": e.coveredmarket.id(), "amount": "300000000000", "msg": json!({ "serial": s, "exercise": true }).to_string() }))
        .deposit(NearToken::from_yoctonear(1)).max_gas().transact().await?.into_result()?;
    let after: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": e.buyer.id() })).await?.json()?;
    assert_eq!(before.0, after.0, "full refund");
    assert_eq!(state(&e, s).await?["state"], "Sold");
    Ok(())
}

#[tokio::test]
async fn operator_cannot_spend_with_same_path() -> Result<()> {
    // A1: another account asking the signer for the same path gets a different key.
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    let v = state(&e, s).await?;
    let path = v["path"].as_str().unwrap();
    let ops_key: String = e.anyone.call(e.signer.id(), "derived_public_key").args_json(json!({ "path": path })).transact().await?.json()?;
    assert_ne!(ops_key, v["derived_pubkey"].as_str().unwrap());
    Ok(())
}

#[tokio::test]
async fn wrong_key_signature_is_rejected_and_retried() -> Result<()> {
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    e.signer.call("set_wrong_key_next").args_json(json!({ "n": 1 })).transact().await?.into_result()?;
    e.seller.call(e.coveredmarket.id(), "withdraw").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    let v = state(&e, s).await?;
    assert_eq!(v["state"], "Committed", "a signature from the wrong key is not accepted");
    // and the offer cannot be sold while committed (A8)
    assert!(buy(&e, s, 6_000_000_000).await.is_err() || state(&e, s).await?["state"] == "Committed");
    Ok(())
}

#[tokio::test]
async fn seller_who_never_held_usdc_can_claim() -> Result<()> {
    // Circle's USDC (and this NEP-141) pays only registered accounts; the contract registers the payee.
    let e = setup().await?;
    let fresh = e.worker.dev_create_account().await?;
    let reg: Option<serde_json::Value> = e.usdc.view("storage_balance_of").args_json(json!({ "account_id": fresh.id() })).await?.json()?;
    assert!(reg.is_none(), "fresh seller is not registered with the token");
    let s = create_and_fund_as(&e, &fresh, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    buy(&e, s, 6_000_000_000).await?;
    fresh.call(e.coveredmarket.id(), "claim").max_gas().transact().await?.into_result()?;
    let bal: U128 = e.usdc.view("ft_balance_of").args_json(json!({ "account_id": fresh.id() })).await?.json()?;
    assert_eq!(bal.0, 6_000_000_000, "premium paid to a seller who was never registered");
    let claimable: U128 = e.coveredmarket.view("get_claimable").args_json(json!({ "account": fresh.id() })).await?.json()?;
    assert_eq!(claimable.0, 0);
    Ok(())
}

#[tokio::test]
async fn stuck_settlement_is_fee_bumped_and_the_old_version_still_settles() -> Result<()> {
    let e = setup().await?;
    let s = create_and_fund(&e, 200_000_000, 150_000_000_000, 6_000_000_000).await?;
    e.seller.call(e.coveredmarket.id(), "withdraw").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    let v1 = state(&e, s).await?;
    assert_eq!(v1["state"], "Signed");
    let raw1 = hex::decode(v1["signed_tx"].as_str().unwrap())?;
    assert_valid_spend(&v1, &raw1);
    // too early
    assert!(e.anyone.call(e.coveredmarket.id(), "bump_fee").args_json(json!({ "serial": s })).max_gas().transact().await?.is_failure());
    let signed_at: u64 = v1["signed_at_s"].as_str().unwrap().parse()?;
    fast_forward_to(&e, signed_at + 61).await?;
    e.anyone.call(e.coveredmarket.id(), "bump_fee").args_json(json!({ "serial": s })).max_gas().transact().await?.into_result()?;
    let v2 = state(&e, s).await?;
    assert_eq!(v2["state"], "Signed", "re-signed in the same transaction");
    assert_eq!(v2["commitment_fee_sats"], "2000");
    assert_eq!(v2["prior_txids"][0], v1["commitment_txid"]);
    assert_eq!(v2["commitment_to_address"], v1["commitment_to_address"]);
    let raw2 = hex::decode(v2["signed_tx"].as_str().unwrap())?;
    assert_valid_spend(&v2, &raw2);
    // the first (lower-fee) version is the one that confirmed
    let tx1: bitcoin::Transaction = deserialize(&raw1)?;
    let block = "33".repeat(32);
    e.lc.call("set_included").args_json(json!({ "tx_id": tx1.compute_txid().to_string(), "block_hash": block, "depth": 1 })).transact().await?.into_result()?;
    e.anyone.call(e.coveredmarket.id(), "confirm_spend")
        .args_json(json!({ "serial": s, "proof": { "tx_raw": hex::encode(&raw1), "block_hash": block, "tx_index": 0, "merkle_proof": [], "coinbase_tx_id": "00".repeat(32), "coinbase_merkle_proof": [] }}))
        .max_gas().transact().await?.into_result()?;
    assert_eq!(state(&e, s).await?["state"], "Withdrawn");
    Ok(())
}
