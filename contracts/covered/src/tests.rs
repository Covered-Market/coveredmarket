//! L0 unit tests: state machine, guards, commitments, signatures, accounting.
//! The MPC is simulated with a known root scalar so derived private keys are
//! computable; the light client answers are injected through the callbacks.

use super::*;
use crate::ext::{BigR, Scalar as S, SignatureResponse};
use k256::ecdsa::signature::hazmat::PrehashSigner;
use k256::elliptic_curve::sec1::ToEncodedPoint;
use k256::elliptic_curve::PrimeField;
use k256::{ProjectivePoint, Scalar};
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

const ROOT_SCALAR: [u8; 32] = [11u8; 32];
const DAY: u64 = 86_400;
const T0: u64 = 1_800_000_000; // some Tuesday, not at 08:00

fn root_key_hex() -> String {
    let r = Scalar::from_repr(ROOT_SCALAR.into()).unwrap();
    hex::encode((ProjectivePoint::GENERATOR * r).to_affine().to_encoded_point(false).as_bytes())
}

fn params() -> Params {
    Params {
        signer: "signer.test".parse().unwrap(),
        light_client: "btc.test".parse().unwrap(),
        usdc: "usdc.test".parse().unwrap(),
        usdc_decimals: 6,
        network: Network::Regtest,
        min_conf: 1,
        fee_sats: 1_000,
        grace_s: 7_200,
        buy_cutoff_s: 3_600,
        min_lead_s: DAY,
        escrow_timeout_s: 7 * DAY,
        min_size_sats: 100_000,
        expiry_step_s: 86_400,
        expiry_offset_s: 8 * 3600,
        mpc_root_key: root_key_hex(),
        derivation_prefix: derive::DEFAULT_PREFIX.into(),
        sign_format: 2,
        sign_deposit: NearToken::from_millinear(50),
    }
}

fn ctx(pred: AccountId, t: u64, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id("covered.test".parse().unwrap())
        .predecessor_account_id(pred)
        .block_timestamp(t * 1_000_000_000)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(10));
    b
}
fn set(pred: &AccountId, t: u64) {
    testing_env!(ctx(pred.clone(), t, NearToken::from_yoctonear(0)).build());
}
fn set_dep(pred: &AccountId, t: u64, dep: NearToken) {
    testing_env!(ctx(pred.clone(), t, dep).build());
}
fn me() -> AccountId {
    "covered.test".parse().unwrap()
}
fn usdc() -> AccountId {
    "usdc.test".parse().unwrap()
}
fn seller() -> AccountId {
    accounts(1)
}
fn buyer() -> AccountId {
    accounts(2)
}

/// Next 08:00 UTC at least `lead` seconds after `t`.
fn expiry_after(t: u64, lead: u64) -> u64 {
    let mut e = (t / DAY) * DAY + 8 * 3600;
    while e < t + lead {
        e += DAY;
    }
    e
}

fn seller_addr() -> String {
    let pk = [2u8; 33];
    // any valid compressed key: use derive from a scalar
    let s = Scalar::from_repr([9u8; 32].into()).unwrap();
    let p: [u8; 33] = (ProjectivePoint::GENERATOR * s).to_affine().to_encoded_point(true).as_bytes().try_into().unwrap();
    let _ = pk;
    btc::address_for_script(&btc::p2wpkh_script(&p), Network::Regtest)
}
fn buyer_addr() -> String {
    let s = Scalar::from_repr([10u8; 32].into()).unwrap();
    let p: [u8; 33] = (ProjectivePoint::GENERATOR * s).to_affine().to_encoded_point(true).as_bytes().try_into().unwrap();
    btc::address_for_script(&btc::p2wpkh_script(&p), Network::Regtest)
}

fn new_contract() -> Contract {
    set(&seller(), T0);
    Contract::new(params())
}

fn create(c: &mut Contract, size: u64, strike: u128, premium: u128) -> u64 {
    set_dep(&seller(), T0, NearToken::from_near(1));
    c.create_offer(OfferTerms {
        size_sats: U64(size),
        strike_units: U128(strike),
        premium_units: U128(premium),
        expiry_s: U64(expiry_after(T0, DAY)),
        refund_address: seller_addr(),
    })
}

/// A fake deposit transaction paying `value` to the offer's address, plus a change output.
fn deposit_tx(c: &Contract, serial: u64, value: u64) -> (String, [u8; 32]) {
    use bitcoin::hashes::Hash;
    let o = c.offer(serial);
    let tx = bitcoin::Transaction {
        version: bitcoin::transaction::Version::TWO,
        lock_time: bitcoin::absolute::LockTime::ZERO,
        input: vec![bitcoin::TxIn {
            previous_output: bitcoin::OutPoint { txid: bitcoin::Txid::from_byte_array([1; 32]), vout: 0 },
            script_sig: bitcoin::ScriptBuf::new(),
            sequence: bitcoin::Sequence::MAX,
            witness: bitcoin::Witness::new(),
        }],
        output: vec![
            bitcoin::TxOut { value: bitcoin::Amount::from_sat(12_345), script_pubkey: bitcoin::ScriptBuf::from_bytes(o.refund_script.clone()) },
            bitcoin::TxOut { value: bitcoin::Amount::from_sat(value), script_pubkey: bitcoin::ScriptBuf::from_bytes(o.script_pubkey.clone()) },
        ],
    };
    (hex::encode(bitcoin::consensus::serialize(&tx)), tx.compute_txid().to_byte_array())
}

fn proof_for(raw: &str) -> Proof {
    Proof { tx_raw: raw.into(), block_hash: "00".repeat(32), tx_index: 3, merkle_proof: vec!["11".repeat(32)] }
}

/// Fund an offer: confirm_deposit then the callback with the light client saying yes.
fn fund(c: &mut Contract, serial: u64) -> [u8; 32] {
    let size = c.offer(serial).size_sats;
    let (raw, txid) = deposit_tx(c, serial, size);
    set(&seller(), T0 + 10);
    let _ = c.confirm_deposit(serial, proof_for(&raw));
    set(&me(), T0 + 11);
    let pref = ProofRef::from_proof(&proof_for(&raw), txid);
    assert!(c.on_deposit_verified(serial, Outpoint { txid, vout: 1, value_sats: size }, pref, Ok(true)));
    assert_eq!(c.offer(serial).state, State::Funded);
    txid
}

fn buy(c: &mut Contract, serial: u64, amount: u128, t: u64) -> u128 {
    set(&usdc(), t);
    let msg = serde_json::json!({ "serial": serial, "btc_address": buyer_addr() }).to_string();
    match c.ft_on_transfer(buyer(), U128(amount), msg) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("purchase must not create a promise"),
    }
}

fn exercise(c: &mut Contract, serial: u64, amount: u128, t: u64) {
    set(&usdc(), t);
    let msg = serde_json::json!({ "serial": serial, "exercise": true }).to_string();
    match c.ft_on_transfer(buyer(), U128(amount), msg) {
        PromiseOrValue::Promise(_) => {}
        _ => panic!("exercise must create the depth-check promise"),
    }
}

/// The MPC: sign a sighash with the derived private key for `path`.
fn mpc_sign(path: &str, sighash: &[u8; 32], good: bool) -> SignatureResponse {
    let r = Scalar::from_repr(ROOT_SCALAR.into()).unwrap();
    let eps = Scalar::from_repr(derive::epsilon(derive::DEFAULT_PREFIX, "covered.test", path).into()).unwrap();
    let mut d = r + eps;
    if !good {
        d += Scalar::ONE;
    }
    let sk = k256::ecdsa::SigningKey::from_bytes(&d.to_bytes()).unwrap();
    let sig: k256::ecdsa::Signature = sk.sign_prehash(sighash).unwrap();
    let b: [u8; 64] = sig.to_bytes().into();
    SignatureResponse {
        big_r: BigR { affine_point: format!("02{}", hex::encode(&b[..32])) },
        s: S { scalar: hex::encode(&b[32..]) },
        recovery_id: 0,
    }
}

fn sign_committed(c: &mut Contract, serial: u64, t: u64) {
    let (path, sighash) = {
        let o = c.offer(serial);
        (o.path.clone(), o.commitment.as_ref().unwrap().sighash)
    };
    set(&me(), t);
    assert!(c.on_signed(serial, Ok(mpc_sign(&path, &sighash, true))));
    assert_eq!(c.offer(serial).state, State::Signed);
}

fn assert_witness_valid(c: &Contract, serial: u64) {
    use bitcoin::hashes::Hash;
    let o = c.offer(serial);
    let cm = o.commitment.as_ref().unwrap();
    let raw = cm.signed_tx.as_ref().unwrap();
    let tx: bitcoin::Transaction = bitcoin::consensus::deserialize(raw).unwrap();
    assert_eq!(tx.compute_txid().to_byte_array(), cm.txid);
    assert_eq!(tx.input.len(), 1);
    assert_eq!(tx.output.len(), 1);
    assert_eq!(tx.output[0].value.to_sat(), cm.amount_sats);
    assert_eq!(tx.output[0].script_pubkey.to_bytes(), cm.to_script);
    let der = &tx.input[0].witness[0];
    let secp = bitcoin::secp256k1::Secp256k1::verification_only();
    let sig = bitcoin::secp256k1::ecdsa::Signature::from_der(&der[..der.len() - 1]).unwrap();
    let pk = bitcoin::secp256k1::PublicKey::from_slice(&tx.input[0].witness[1]).unwrap();
    assert_eq!(&tx.input[0].witness[1][..], &o.derived_pubkey[..]);
    secp.verify_ecdsa(&bitcoin::secp256k1::Message::from_digest(cm.sighash), &sig, &pk).unwrap();
}

fn accounting_ok(c: &Contract, token_balance: u128) {
    let a = c.get_accounting();
    assert_eq!(a.claimable_total.0 + a.escrow_total.0, token_balance, "N2 accounting invariant");
}

// ───────────────────────────── tests ─────────────────────────────

#[test]
fn create_offer_derives_unique_addresses() {
    let mut c = new_contract();
    let a = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    let b = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    assert_ne!(c.get_address(a), c.get_address(b));
    assert!(c.get_address(a).starts_with("bcrt1q"));
    assert_eq!(c.offer(a).path, format!("{}/CV-1", seller()));
    assert_eq!(c.derive_address(c.offer(a).path.clone()), c.get_address(a));
    let v = c.get_offer(a).unwrap();
    assert_eq!(v.strike_total_units.0, 300_000_000_000);
}

#[test]
#[should_panic(expected = "expiry not on the allowed grid")]
fn create_offer_rejects_non_0800_expiry() {
    let mut c = new_contract();
    set_dep(&seller(), T0, NearToken::from_near(1));
    c.create_offer(OfferTerms { size_sats: U64(200_000), strike_units: U128(1), premium_units: U128(1), expiry_s: U64(expiry_after(T0, DAY) + 60), refund_address: seller_addr() });
}

#[test]
#[should_panic(expected = "expiry too soon")]
fn create_offer_rejects_short_lead() {
    let mut c = new_contract();
    set_dep(&seller(), T0, NearToken::from_near(1));
    c.create_offer(OfferTerms { size_sats: U64(200_000), strike_units: U128(1), premium_units: U128(1), expiry_s: U64(expiry_after(T0, 0)), refund_address: seller_addr() });
}

#[test]
#[should_panic(expected = "refund_address must be a v0 witness")]
fn create_offer_rejects_mainnet_address_on_regtest() {
    let mut c = new_contract();
    set_dep(&seller(), T0, NearToken::from_near(1));
    c.create_offer(OfferTerms { size_sats: U64(200_000), strike_units: U128(1), premium_units: U128(1), expiry_s: U64(expiry_after(T0, DAY)), refund_address: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq".into() });
}

#[test]
fn strike_rounds_up() {
    assert_eq!(strike_total_units(100_000_000, 150_000_000_000), 150_000_000_000);
    assert_eq!(strike_total_units(1, 150_000_000_000), 1_500); // 1 sat * $150k = $0.0015 → 1500 units exactly
    assert_eq!(strike_total_units(1, 1), 1); // ceil(1/1e8) = 1 unit, never 0
}

#[test]
#[should_panic(expected = "deposit must be exactly size_sats")]
fn deposit_wrong_amount_refused() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    let (raw, _) = deposit_tx(&c, s, 150_000_000);
    set(&seller(), T0 + 10);
    let _ = c.confirm_deposit(s, proof_for(&raw));
}

#[test]
fn deposit_refused_by_light_client_stays_created() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    let (raw, txid) = deposit_tx(&c, s, 200_000_000);
    set(&me(), T0 + 11);
    let pref = ProofRef::from_proof(&proof_for(&raw), txid);
    assert!(!c.on_deposit_verified(s, Outpoint { txid, vout: 1, value_sats: 200_000_000 }, pref, Ok(false)));
    assert_eq!(c.offer(s).state, State::Created);
    assert!(c.offer(s).collateral.is_none());
}

#[test]
fn flow_kept() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    assert_eq!(c.get_offers(0, 10).len(), 1);
    // buy with excess; excess returned, premium claimable, sale final
    let refund = buy(&mut c, s, 6_500_000_000, T0 + 100);
    assert_eq!(refund, 500_000_000);
    assert_eq!(c.offer(s).state, State::Sold);
    assert_eq!(c.get_claimable(seller()).0, 6_000_000_000);
    accounting_ok(&c, 6_000_000_000);
    let expiry = c.offer(s).expiry_s;
    // settle before window closes → refused
    set(&accounts(3), expiry + 7_199);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle(s))).is_err());
    // after window: anyone settles
    set(&accounts(3), expiry + 7_200);
    let _ = c.settle(s);
    let o = c.offer(s);
    assert_eq!(o.state, State::Committed);
    let cm = o.commitment.as_ref().unwrap();
    assert_eq!(cm.reason, Reason::Expiry);
    assert_eq!(cm.to_script, o.refund_script);
    assert_eq!(cm.amount_sats, 200_000_000 - 1_000);
    // bad signature → stays Committed, retry scheduled
    let (path, sighash) = (o.path.clone(), cm.sighash);
    set(&me(), expiry + 7_210);
    assert!(!c.on_signed(s, Ok(mpc_sign(&path, &sighash, false))));
    assert_eq!(c.offer(s).state, State::Committed);
    assert_eq!(c.offer(s).retry_after_s, Some(expiry + 7_210 + 600));
    // MPC failure → same
    set(&me(), expiry + 7_220);
    assert!(!c.on_signed(s, Err(PromiseError::Failed)));
    // retry too early refused
    set(&accounts(3), expiry + 7_300);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.request_signature(s))).is_err());
    set(&accounts(3), expiry + 7_220 + 600);
    let _ = c.request_signature(s);
    // good signature
    sign_committed(&mut c, s, expiry + 8_000);
    assert_witness_valid(&c, s);
    assert!(c.get_signed_tx(s).is_some());
    // duplicate / late callback ignored
    set(&me(), expiry + 8_001);
    assert!(c.on_signed(s, Err(PromiseError::Failed)));
    assert_eq!(c.offer(s).state, State::Signed);
    // confirm spend
    let raw = c.get_signed_tx(s).unwrap();
    set(&accounts(3), expiry + 9_000);
    let _ = c.confirm_spend(s, proof_for(&raw));
    set(&me(), expiry + 9_001);
    assert!(c.on_spend_verified(s, Ok(true)));
    assert_eq!(c.offer(s).state, State::Kept);
    assert_eq!(c.get_offers(0, 10).len(), 0);
    accounting_ok(&c, 6_000_000_000);
    // seller claims; callback failure restores balance
    set(&seller(), expiry + 9_100);
    let _ = c.claim();
    assert_eq!(c.get_claimable(seller()).0, 0);
    set(&me(), expiry + 9_101);
    assert!(!c.on_claim(seller(), U128(6_000_000_000), Err(PromiseError::Failed)));
    assert_eq!(c.get_claimable(seller()).0, 6_000_000_000);
    set(&seller(), expiry + 9_200);
    let _ = c.claim();
    set(&me(), expiry + 9_201);
    assert!(c.on_claim(seller(), U128(6_000_000_000), Ok(())));
    accounting_ok(&c, 0);
}

#[test]
fn flow_exercised() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    buy(&mut c, s, 6_000_000_000, T0 + 100);
    let expiry = c.offer(s).expiry_s;
    let strike_total = 300_000_000_000u128;
    // before window: refused
    set(&usdc(), expiry - 1);
    let msg = serde_json::json!({ "serial": s, "exercise": true }).to_string();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(strike_total), msg.clone()))).is_err());
    // at window close: refused (A6)
    set(&usdc(), expiry + 7_200);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(strike_total), msg.clone()))).is_err());
    // wrong sender: refused (A15)
    set(&usdc(), expiry + 10);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(accounts(4), U128(strike_total), msg.clone()))).is_err());
    // underpay: refused (A5)
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(strike_total - 1), msg.clone()))).is_err());
    // in window, with excess
    exercise(&mut c, s, strike_total + 7, expiry + 10);
    assert_eq!(c.offer(s).state, State::ExercisePending);
    assert_eq!(c.get_accounting().escrow_total.0, strike_total);
    // settle during pending → refused
    set(&accounts(3), expiry + 7_200);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle(s))).is_err());
    // depth ok → committed to buyer
    set(&me(), expiry + 11);
    match c.on_exercise_depth(s, U128(7), U128(strike_total + 7), Ok(true)) {
        PromiseOrValue::Promise(_) => {}
        _ => panic!("expected promise chain"),
    }
    let o = c.offer(s);
    assert_eq!(o.state, State::Committed);
    let cm = o.commitment.as_ref().unwrap();
    assert_eq!(cm.reason, Reason::Exercise);
    assert_eq!(cm.to_script, o.buyer_script.clone().unwrap());
    // settle after window while committed → refused (commitment stands)
    set(&accounts(3), expiry + 8_000);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle(s))).is_err());
    sign_committed(&mut c, s, expiry + 8_100);
    assert_witness_valid(&c, s);
    // reclaim before timeout refused; after timeout works
    set(&buyer(), expiry + 8_200);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.reclaim_strike(s))).is_err());
    // confirm spend releases escrow to seller
    let raw = c.get_signed_tx(s).unwrap();
    set(&accounts(3), expiry + 9_000);
    let _ = c.confirm_spend(s, proof_for(&raw));
    set(&me(), expiry + 9_001);
    assert!(c.on_spend_verified(s, Ok(true)));
    assert_eq!(c.offer(s).state, State::Exercised);
    assert_eq!(c.get_claimable(seller()).0, 6_000_000_000 + strike_total);
    assert_eq!(c.get_accounting().escrow_total.0, 0);
    accounting_ok(&c, 6_000_000_000 + strike_total);
}

#[test]
fn exercise_refused_on_depth_refunds_everything() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    buy(&mut c, s, 6_000_000_000, T0 + 100);
    let expiry = c.offer(s).expiry_s;
    exercise(&mut c, s, 300_000_000_000, expiry + 10);
    set(&me(), expiry + 11);
    match c.on_exercise_depth(s, U128(0), U128(300_000_000_000), Ok(false)) {
        PromiseOrValue::Value(v) => assert_eq!(v.0, 300_000_000_000),
        _ => panic!("expected full refund"),
    }
    assert_eq!(c.offer(s).state, State::Sold);
    assert_eq!(c.get_accounting().escrow_total.0, 0);
    // window still open: buyer can try again
    exercise(&mut c, s, 300_000_000_000, expiry + 20);
    assert_eq!(c.offer(s).state, State::ExercisePending);
}

#[test]
fn reclaim_after_timeout() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    buy(&mut c, s, 6_000_000_000, T0 + 100);
    let expiry = c.offer(s).expiry_s;
    exercise(&mut c, s, 300_000_000_000, expiry + 10);
    set(&me(), expiry + 11);
    let _ = c.on_exercise_depth(s, U128(0), U128(300_000_000_000), Ok(true));
    set(&buyer(), expiry + 11 + 7 * DAY);
    c.reclaim_strike(s);
    assert_eq!(c.get_claimable(buyer()).0, 300_000_000_000);
    assert_eq!(c.get_accounting().escrow_total.0, 0);
    // a later confirm_spend must not credit the seller twice
    sign_committed(&mut c, s, expiry + 11 + 7 * DAY + 10);
    set(&me(), expiry + 11 + 7 * DAY + 20);
    assert!(c.on_spend_verified(s, Ok(true)));
    assert_eq!(c.get_claimable(seller()).0, 6_000_000_000);
    accounting_ok(&c, 6_000_000_000 + 300_000_000_000);
}

#[test]
fn withdraw_then_sale_refused_commitment_stands() {
    // A8: withdraw commits; a sign failure must not reopen the offer for sale.
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    set(&seller(), T0 + 200);
    let _ = c.withdraw(s);
    assert_eq!(c.offer(s).state, State::Committed);
    set(&me(), T0 + 201);
    assert!(!c.on_signed(s, Err(PromiseError::Failed)));
    assert_eq!(c.offer(s).state, State::Committed);
    set(&usdc(), T0 + 300);
    let msg = serde_json::json!({ "serial": s, "btc_address": buyer_addr() }).to_string();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(6_000_000_000), msg))).is_err());
    // the retried signature is for the identical sighash
    let sh1 = c.offer(s).commitment.as_ref().unwrap().sighash;
    set(&accounts(3), T0 + 201 + 600);
    let _ = c.request_signature(s);
    assert_eq!(c.offer(s).commitment.as_ref().unwrap().sighash, sh1);
    sign_committed(&mut c, s, T0 + 1_000);
    let raw = c.get_signed_tx(s).unwrap();
    set(&accounts(3), T0 + 1_100);
    let _ = c.confirm_spend(s, proof_for(&raw));
    set(&me(), T0 + 1_101);
    assert!(c.on_spend_verified(s, Ok(true)));
    assert_eq!(c.offer(s).state, State::Withdrawn);
}

#[test]
fn withdraw_after_sale_refused() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    buy(&mut c, s, 6_000_000_000, T0 + 100);
    set(&seller(), T0 + 200);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.withdraw(s))).is_err());
}

#[test]
fn purchase_guards() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    // not funded
    set(&usdc(), T0 + 100);
    let msg = serde_json::json!({ "serial": s, "btc_address": buyer_addr() }).to_string();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(6_000_000_000), msg.clone()))).is_err());
    fund(&mut c, s);
    // wrong token
    set(&accounts(5), T0 + 100);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(6_000_000_000), msg.clone()))).is_err());
    // underpay
    set(&usdc(), T0 + 100);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(5_999_999_999), msg.clone()))).is_err());
    // too close to expiry
    let expiry = c.offer(s).expiry_s;
    set(&usdc(), expiry - 3_600);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(6_000_000_000), msg.clone()))).is_err());
    // mainnet address on regtest
    set(&usdc(), T0 + 100);
    let bad = serde_json::json!({ "serial": s, "btc_address": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" }).to_string();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(buyer(), U128(6_000_000_000), bad))).is_err());
    // ok, then a second purchase refused
    assert_eq!(buy(&mut c, s, 6_000_000_000, T0 + 100), 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.ft_on_transfer(accounts(4), U128(6_000_000_000), msg))).is_err());
}

#[test]
fn outpoint_cannot_be_reused_as_collateral() {
    let mut c = new_contract();
    let a = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    let txid = fund(&mut c, a);
    // the same outpoint offered to a second offer's callback is refused (A12)
    let b = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    set(&me(), T0 + 50);
    let pref = ProofRef { txid_display: btc::display_hex(&txid), block_hash: "00".repeat(32), tx_index: 0, merkle_proof: vec![] };
    assert!(!c.on_deposit_verified(b, Outpoint { txid, vout: 1, value_sats: 200_000_000 }, pref, Ok(true)));
    assert_eq!(c.offer(b).state, State::Created);
}

#[test]
fn recovery_only_outside_live_states() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    // while Created: a wrong-amount deposit can be recovered
    let (raw, txid) = deposit_tx(&c, s, 150_000_000);
    set(&seller(), T0 + 10);
    let _ = c.recover(s, proof_for(&raw));
    let o = c.offer(s);
    let u = btc::build_spend(&Outpoint { txid, vout: 1, value_sats: 150_000_000 }, &o.script_pubkey, &o.refund_script, 1_000).unwrap();
    set(&me(), T0 + 11);
    let r = c.on_recovery_verified(s, Outpoint { txid, vout: 1, value_sats: 150_000_000 }, ext::Bytes(bitcoin::consensus::serialize(&u.tx)), u.sighash, u.txid, u.amount_sats, Ok(true));
    assert!(matches!(r, PromiseOrValue::Promise(_)));
    assert_eq!(c.offer(s).state, State::Created, "recovery leaves the offer untouched");
    // the recovered outpoint can never become collateral
    set(&me(), T0 + 12);
    let pref = ProofRef::from_proof(&proof_for(&raw), txid);
    assert!(!c.on_deposit_verified(s, Outpoint { txid, vout: 1, value_sats: 150_000_000 }, pref, Ok(true)));
    // sign the recovery
    let path = c.offer(s).path.clone();
    assert!(c.on_recovery_signed(s, Outpoint { txid, vout: 1, value_sats: 150_000_000 }, Ok(mpc_sign(&path, &u.sighash, true))));
    assert!(c.get_recovery(s, btc::display_hex(&txid), 1, U64(150_000_000)).unwrap().signed_tx.is_some());
    // once Funded, recovery is refused even for a different outpoint
    fund(&mut c, s);
    let (raw2, _) = deposit_tx(&c, s, 170_000_000);
    set(&seller(), T0 + 100);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.recover(s, proof_for(&raw2)))).is_err());
}

#[test]
fn confirm_spend_requires_the_committed_txid() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    fund(&mut c, s);
    set(&seller(), T0 + 200);
    let _ = c.withdraw(s);
    sign_committed(&mut c, s, T0 + 300);
    let (other, _) = deposit_tx(&c, s, 200_000_000);
    set(&accounts(3), T0 + 400);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.confirm_spend(s, proof_for(&other)))).is_err());
}

#[test]
fn signature_response_compact_parsing() {
    let r = SignatureResponse { big_r: BigR { affine_point: format!("03{}", "ab".repeat(32)) }, s: S { scalar: "cd".repeat(32) }, recovery_id: 1 };
    let c = r.compact().unwrap();
    assert_eq!(&c[..32], &[0xab; 32]);
    assert_eq!(&c[32..], &[0xcd; 32]);
    let bad = SignatureResponse { big_r: BigR { affine_point: "00".into() }, s: S { scalar: "cd".repeat(32) }, recovery_id: 0 };
    assert!(bad.compact().is_none());
}

#[test]
fn sign_args_formats() {
    let a1: serde_json::Value = serde_json::from_slice(&ext::sign_args(1, "p", &[1u8; 32])).unwrap();
    assert!(a1["request"]["payload"].is_array());
    let a2: serde_json::Value = serde_json::from_slice(&ext::sign_args(2, "p", &[1u8; 32])).unwrap();
    assert_eq!(a2["request"]["payload_v2"]["Ecdsa"], "01".repeat(32));
    assert_eq!(a2["request"]["domain_id"], 0);
}

/// Vectors for the TypeScript derivation and Verify code (web/src/verify.test.ts).
#[test]
fn print_vectors_for_web() {
    let mut c = new_contract();
    let s = create(&mut c, 200_000_000, 150_000_000_000, 6_000_000_000);
    let o = c.offer(s);
    fund(&mut c, s);
    set(&seller(), T0 + 200);
    let _ = c.withdraw(s);
    let o = c.offer(s);
    let cm = o.commitment.as_ref().unwrap();
    let v = serde_json::json!({
        "collateral_txid": btc::display_hex(&cm.outpoint.txid),
        "collateral_vout": cm.outpoint.vout,
        "collateral_value_sats": cm.outpoint.value_sats,
        "collateral_script": hex::encode(&o.script_pubkey),
        "to_script": hex::encode(&cm.to_script),
        "fee_sats": 1000,
        "unsigned_tx": hex::encode(&cm.unsigned_tx),
        "sighash": hex::encode(cm.sighash),
        "txid": btc::display_hex(&cm.txid),
        "root_key_hex": root_key_hex(),
        "prefix": derive::DEFAULT_PREFIX,
        "predecessor": "covered.test",
        "path": o.path,
        "derived_pubkey": hex::encode(&o.derived_pubkey),
        "address_regtest": c.get_address(s),
    });
    std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/src/vectors.json"), serde_json::to_string_pretty(&v).unwrap()).unwrap();
}
