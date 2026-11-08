//! CoveredMarket: non-custodial covered calls on native Bitcoin.
//!
//! One contract, no owner. Two cross-contract dependencies: the Bitcoin light
//! client (inclusion proofs) and the Chain Signatures signer (`sign`). USDC
//! arrives only through `ft_on_transfer` from the pinned token and leaves only
//! through `claim` / `reclaim_strike` to the account that owns the balance.
//!
//! Spec: "CoveredMarket — Product & Technical Specification", sections 6–9.

pub mod btc;
pub mod derive;
pub mod events;
pub mod ext;

use btc::{Network, Outpoint};
use ext::{ext_ft, ProofRef, SignatureResponse};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue,
};

const GAS_LC_VERIFY: Gas = Gas::from_tgas(30);
const GAS_SIGN: Gas = Gas::from_tgas(150);
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_CB_SMALL: Gas = Gas::from_tgas(15);
const GAS_CB_SIGN: Gas = Gas::from_tgas(30);
const RETRY_DELAY_S: u64 = 600;
/// Reserved derivation path for `selftest_sign`; offers use `<seller>/CV-<serial>`.
const SELFTEST_PATH: &str = "coveredmarket/selftest";
const DUST_SATS: u64 = 546;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    Created,
    Funded,
    Sold,
    ExercisePending,
    Committed,
    Signed,
    Kept,
    Exercised,
    Withdrawn,
    Cancelled,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Withdraw,
    Expiry,
    Exercise,
    Recovery,
}

/// Written once before the first signature request (G5). Its outpoint and recipient never change.
/// Only the fee may rise, via `bump_fee`, within `max_fee_sats`: each bump is a new version of the same
/// spend; earlier versions stay valid (any one of them confirming settles the offer).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Commitment {
    pub reason: Reason,
    pub outpoint: Outpoint,
    pub to_script: Vec<u8>,
    pub amount_sats: u64,
    pub unsigned_tx: Vec<u8>,
    pub sighash: [u8; 32],
    pub txid: [u8; 32],
    pub signed_tx: Option<Vec<u8>>,
    pub committed_at_s: u64,
    pub fee_sats: u64,
    /// Txids of earlier, signed versions (lower fees).
    pub prior_txids: Vec<[u8; 32]>,
    pub signed_at_s: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Params {
    pub signer: AccountId,
    pub light_client: AccountId,
    pub usdc: AccountId,
    pub usdc_decimals: u8,
    pub network: Network,
    pub min_conf: u64,
    pub fee_sats: u64,
    pub grace_s: u64,
    pub buy_cutoff_s: u64,
    pub min_lead_s: u64,
    pub escrow_timeout_s: u64,
    pub min_size_sats: u64,
    /// Expiries must satisfy `expiry % expiry_step_s == expiry_offset_s` (production: 86400 / 28800 = daily at 08:00 UTC).
    pub expiry_step_s: u64,
    pub expiry_offset_s: u64,
    /// Signer root public key (`secp256k1:...` or hex).
    pub mpc_root_key: String,
    pub derivation_prefix: String,
    /// 1 = `{payload, path, key_version}`, 2 = `{payload_v2: {Ecdsa}, path, domain_id}`.
    pub sign_format: u8,
    pub sign_deposit: NearToken,
    /// Largest offer this deployment accepts (a deploy-time cap while the code is unaudited).
    pub max_size_sats: u64,
    /// Fee bumps double the settlement fee up to this many sats.
    pub max_fee_sats: u64,
    /// A signed settlement may be bumped this long after its last signature if still unproven.
    pub fee_bump_after_s: u64,
    /// The seller's exit unlocks this long after expiry + grace (absolute time, fixed per offer).
    pub rescue_delay_s: u64,
    /// NEAR attached to `storage_deposit` when paying an account the token has not seen
    /// (Circle USDC: 0.00125 NEAR). Reserved from each offer's creation deposit.
    pub usdc_storage_deposit: NearToken,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub serial: u64,
    pub seller: AccountId,
    pub buyer: Option<AccountId>,
    pub size_sats: u64,
    /// USDC units per whole BTC.
    pub strike_units: u128,
    pub premium_units: u128,
    pub expiry_s: u64,
    pub created_s: u64,
    pub path: String,
    pub derived_pubkey: Vec<u8>,
    /// The seller's rescue key (compressed) and when its branch unlocks (Unix time).
    pub rescue_pubkey: Vec<u8>,
    pub unlock_s: u64,
    pub witness_script: Vec<u8>,
    /// P2WSH of `witness_script`: the deposit address.
    pub script_pubkey: Vec<u8>,
    pub refund_script: Vec<u8>,
    pub buyer_script: Option<Vec<u8>>,
    pub collateral: Option<Outpoint>,
    pub deposit_proof: Option<ProofRef>,
    pub commitment: Option<Commitment>,
    pub escrow_units: u128,
    pub retry_after_s: Option<u64>,
    pub state: State,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OfferTerms {
    pub size_sats: U64,
    pub strike_units: U128,
    pub premium_units: U128,
    pub expiry_s: U64,
    /// Seller's own address; coins return here. bech32 for the configured network.
    pub refund_address: String,
    /// Compressed public key (hex) of the seller's rescue key: after `unlock_s` it alone can move the
    /// coins, without NEAR. Keep its private half offline (the app's rescue kit).
    pub rescue_pubkey: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Proof {
    /// Raw transaction hex (with or without witness).
    pub tx_raw: String,
    /// Block hash, display order hex, as explorers print it.
    pub block_hash: String,
    pub tx_index: u64,
    /// Merkle branch, display order hex each.
    pub merkle_proof: Vec<String>,
    /// The block's coinbase txid and its Merkle branch (required by the light client's v2 check).
    #[serde(default)]
    pub coinbase_tx_id: String,
    #[serde(default)]
    pub coinbase_merkle_proof: Vec<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Accounting {
    pub claimable_total: U128,
    pub escrow_total: U128,
    pub near_balance: NearToken,
    pub open_offers: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OfferView {
    pub serial: u64,
    pub seller: AccountId,
    pub buyer: Option<AccountId>,
    pub size_sats: U64,
    pub strike_units: U128,
    pub strike_total_units: U128,
    pub premium_units: U128,
    pub expiry_s: U64,
    pub created_s: U64,
    pub path: String,
    pub derived_pubkey: String,
    pub rescue_pubkey: String,
    pub unlock_s: U64,
    pub witness_script: String,
    pub address: String,
    pub refund_address: String,
    pub buyer_address: Option<String>,
    pub collateral_txid: Option<String>,
    pub collateral_vout: Option<u32>,
    pub collateral_value_sats: Option<U64>,
    pub commitment_reason: Option<Reason>,
    pub commitment_txid: Option<String>,
    pub commitment_sighash: Option<String>,
    pub commitment_to_address: Option<String>,
    pub commitment_amount_sats: Option<U64>,
    pub committed_at_s: Option<U64>,
    pub commitment_fee_sats: Option<U64>,
    pub prior_txids: Vec<String>,
    pub signed_at_s: Option<U64>,
    pub signed_tx: Option<String>,
    pub escrow_units: U128,
    pub retry_after_s: Option<U64>,
    pub state: State,
}

#[derive(Debug, Clone)]
#[near(serializers = [json])]
pub struct TransferMsg {
    pub serial: u64,
    #[serde(default)]
    pub btc_address: Option<String>,
    #[serde(default)]
    pub exercise: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    params: Params,
    root_key: [u8; 65],
    next_serial: u64,
    offers: LookupMap<u64, Offer>,
    by_account: LookupMap<AccountId, Vector<u64>>,
    open: IterableSet<u64>,
    created: IterableSet<u64>,
    /// Every outpoint ever accepted as collateral or committed for recovery.
    outpoints: LookupSet<Outpoint>,
    claimable: LookupMap<AccountId, u128>,
    claimable_total: u128,
    escrow_total: u128,
    recoveries: LookupMap<(u64, Outpoint), Commitment>,
}

fn now_s() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

pub fn strike_total_units(size_sats: u64, strike_units: u128) -> u128 {
    // ceil(size_sats * strike_units / 1e8), checked.
    let num = (size_sats as u128).checked_mul(strike_units).expect("overflow");
    num.div_ceil(100_000_000)
}

#[near]
impl Contract {
    #[init]
    pub fn new(params: Params) -> Self {
        let root_key = derive::parse_root_key(&params.mpc_root_key).expect("bad mpc_root_key");
        require!(params.sign_format == 1 || params.sign_format == 2, "sign_format must be 1 or 2");
        require!(params.fee_sats > 0 && params.min_size_sats > params.fee_sats + DUST_SATS, "bad fee/min_size");
        require!(params.expiry_step_s > 0 && params.expiry_offset_s < params.expiry_step_s, "bad expiry grid");
        require!(params.max_size_sats >= params.min_size_sats, "max_size below min_size");
        require!(params.max_fee_sats >= params.fee_sats && params.max_fee_sats + DUST_SATS < params.min_size_sats, "bad max_fee");
        require!(params.rescue_delay_s >= 2 * params.fee_bump_after_s && params.rescue_delay_s > 0, "rescue delay must leave time to settle and bump");
        Self {
            params,
            root_key,
            next_serial: 1,
            offers: LookupMap::new(b"o"),
            by_account: LookupMap::new(b"a"),
            open: IterableSet::new(b"p"),
            created: IterableSet::new(b"d"),
            outpoints: LookupSet::new(b"u"),
            claimable: LookupMap::new(b"c"),
            claimable_total: 0,
            escrow_total: 0,
            recoveries: LookupMap::new(b"r"),
        }
    }

    // ───────────────────────────── seller ─────────────────────────────

    #[payable]
    pub fn create_offer(&mut self, terms: OfferTerms) -> u64 {
        let seller = env::predecessor_account_id();
        let p = &self.params;
        let now = now_s();
        require!(terms.size_sats.0 >= p.min_size_sats, "size below minimum");
        require!(terms.size_sats.0 <= p.max_size_sats, "size above this deployment's cap");
        require!(terms.strike_units.0 > 0 && terms.premium_units.0 > 0, "strike and premium must be > 0");
        require!(terms.expiry_s.0 >= now + p.min_lead_s, "expiry too soon");
        require!(terms.expiry_s.0 % p.expiry_step_s == p.expiry_offset_s, "expiry not on the allowed grid (production: 08:00 UTC)");
        let refund_script = btc::script_from_address(&terms.refund_address, p.network)
            .unwrap_or_else(|| env::panic_str("refund_address must be a v0 witness address for this network"));
        strike_total_units(terms.size_sats.0, terms.strike_units.0);

        let serial = self.next_serial;
        self.next_serial += 1;
        let path = format!("{}/CV-{}", seller, serial);
        let derived_pubkey = derive::derive_pubkey(
            &self.root_key,
            &p.derivation_prefix,
            env::current_account_id().as_str(),
            &path,
        )
        .unwrap_or_else(|| env::panic_str("derivation failed"));
        let rescue_pubkey: [u8; 33] = hex::decode(&terms.rescue_pubkey)
            .ok()
            .and_then(|b| b.try_into().ok())
            .filter(|b: &[u8; 33]| k256::PublicKey::from_sec1_bytes(b).is_ok())
            .unwrap_or_else(|| env::panic_str("rescue_pubkey must be a 33-byte compressed public key (hex)"));
        require!(rescue_pubkey != derived_pubkey, "rescue key must be the seller's own");
        let unlock_s = terms.expiry_s.0 + p.grace_s + p.rescue_delay_s;
        let witness_script = btc::deposit_witness_script(&derived_pubkey, &rescue_pubkey, unlock_s);
        let script_pubkey = btc::p2wsh_script(&witness_script);

        let storage_before = env::storage_usage();
        let offer = Offer {
            serial,
            seller: seller.clone(),
            buyer: None,
            size_sats: terms.size_sats.0,
            strike_units: terms.strike_units.0,
            premium_units: terms.premium_units.0,
            expiry_s: terms.expiry_s.0,
            created_s: now,
            path,
            derived_pubkey: derived_pubkey.to_vec(),
            rescue_pubkey: rescue_pubkey.to_vec(),
            unlock_s,
            witness_script,
            script_pubkey,
            refund_script,
            buyer_script: None,
            collateral: None,
            deposit_proof: None,
            commitment: None,
            escrow_units: 0,
            retry_after_s: None,
            state: State::Created,
        };
        self.offers.insert(serial, offer);
        self.created.insert(serial);
        self.index_account(&seller, serial);
        self.charge_storage(storage_before, self.params.usdc_storage_deposit);
        events::emit("offer_created", serial, serde_json::json!({ "seller": seller }));
        serial
    }

    pub fn cancel(&mut self, serial: u64) {
        let offer = self.offer_mut(serial);
        require!(offer.seller == env::predecessor_account_id(), "only seller");
        require!(offer.state == State::Created, "only while Created");
        offer.state = State::Cancelled;
        self.created.remove(&serial);
        events::emit("cancelled", serial, serde_json::json!({}));
    }

    /// Anyone may prove the deposit.
    pub fn confirm_deposit(&mut self, serial: u64, proof: Proof) -> Promise {
        let offer = self.offer(serial);
        require!(offer.state == State::Created, "only while Created");
        let (txid, outputs) = self.parse_proof_tx(&proof);
        let matching: Vec<&(u32, u64, Vec<u8>)> =
            outputs.iter().filter(|(_, _, s)| *s == offer.script_pubkey).collect();
        require!(matching.len() == 1, "exactly one output must pay the deposit address");
        let (vout, value, _) = matching[0];
        require!(*value == offer.size_sats, "deposit must be exactly size_sats");
        let outpoint = Outpoint { txid, vout: *vout, value_sats: *value };
        require!(!self.outpoints.contains(&outpoint), "outpoint already used");
        let pref = ProofRef::from_proof(&proof, txid);
        self.lc_verify(&pref, self.params.min_conf).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SMALL)
                .on_deposit_verified(serial, outpoint, pref),
        )
    }

    #[private]
    pub fn on_deposit_verified(
        &mut self,
        serial: u64,
        outpoint: Outpoint,
        proof: ProofRef,
        #[callback_result] r: Result<bool, PromiseError>,
    ) -> bool {
        let ok = matches!(r, Ok(true));
        let offer = self.offer_mut(serial);
        if !ok || offer.state != State::Created || offer.collateral.is_some() {
            events::emit("deposit_refused", serial, serde_json::json!({ "verified": ok }));
            return false;
        }
        if self.outpoints.contains(&outpoint) {
            return false;
        }
        self.outpoints.insert(outpoint.clone());
        let offer = self.offer_mut(serial);
        offer.collateral = Some(outpoint.clone());
        offer.deposit_proof = Some(proof);
        offer.state = State::Funded;
        self.open.insert(serial);
        self.created.remove(&serial);
        events::emit(
            "funded",
            serial,
            serde_json::json!({ "txid": btc::display_hex(&outpoint.txid), "vout": outpoint.vout, "value_sats": outpoint.value_sats }),
        );
        true
    }

    pub fn withdraw(&mut self, serial: u64) -> Promise {
        let offer = self.offer(serial);
        require!(offer.seller == env::predecessor_account_id(), "only seller");
        require!(offer.state == State::Funded, "only while Funded and unsold");
        self.commit_and_sign(serial, Reason::Withdraw)
    }

    /// Return a wrong-amount or stray deposit to the seller. Never while the
    /// offer is live (Funded, Sold, ExercisePending, Committed, Signed).
    pub fn recover(&mut self, serial: u64, proof: Proof) -> Promise {
        let offer = self.offer(serial);
        require!(offer.seller == env::predecessor_account_id(), "only seller");
        require!(
            matches!(offer.state, State::Created | State::Cancelled | State::Kept | State::Exercised | State::Withdrawn),
            "recovery not allowed in this state"
        );
        let (txid, outputs) = self.parse_proof_tx(&proof);
        let paying: Vec<&(u32, u64, Vec<u8>)> =
            outputs.iter().filter(|(_, _, s)| *s == offer.script_pubkey).collect();
        require!(paying.len() == 1, "exactly one output must pay the deposit address");
        let (vout, value, _) = paying[0];
        let outpoint = Outpoint { txid, vout: *vout, value_sats: *value };
        require!(!self.outpoints.contains(&outpoint), "outpoint already used");
        let unsigned = btc::build_spend(&outpoint, &offer.witness_script, &offer.refund_script, self.params.fee_sats)
            .unwrap_or_else(|| env::panic_str("amount too small to recover"));
        let pref = ProofRef::from_proof(&proof, txid);
        self.lc_verify(&pref, self.params.min_conf).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SMALL.saturating_add(GAS_SIGN).saturating_add(GAS_CB_SIGN))
                .on_recovery_verified(serial, outpoint, unsigned.tx.clone().into(), unsigned.sighash, unsigned.txid, unsigned.amount_sats),
        )
    }

    #[private]
    pub fn on_recovery_verified(
        &mut self,
        serial: u64,
        outpoint: Outpoint,
        unsigned_tx: ext::Bytes,
        sighash: [u8; 32],
        txid: [u8; 32],
        amount_sats: u64,
        #[callback_result] r: Result<bool, PromiseError>,
    ) -> PromiseOrValue<bool> {
        if !matches!(r, Ok(true)) || self.outpoints.contains(&outpoint) {
            return PromiseOrValue::Value(false);
        }
        let (path, refund_script) = { let o = self.offer(serial); (o.path.clone(), o.refund_script.clone()) };
        let c = Commitment {
            reason: Reason::Recovery,
            outpoint: outpoint.clone(),
            to_script: refund_script,
            amount_sats,
            unsigned_tx: unsigned_tx.0,
            sighash,
            txid,
            signed_tx: None,
            committed_at_s: now_s(),
            fee_sats: self.params.fee_sats,
            prior_txids: vec![],
            signed_at_s: None,
        };
        self.outpoints.insert(outpoint.clone());
        self.recoveries.insert((serial, outpoint.clone()), c);
        events::emit("recovery_committed", serial, serde_json::json!({ "txid": btc::display_hex(&outpoint.txid), "vout": outpoint.vout }));
        PromiseOrValue::Promise(self.sign_promise(&path, sighash).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SIGN)
                .on_recovery_signed(serial, outpoint),
        ))
    }

    #[private]
    pub fn on_recovery_signed(
        &mut self,
        serial: u64,
        outpoint: Outpoint,
        #[callback_result] r: Result<SignatureResponse, PromiseError>,
    ) -> bool {
        let key = (serial, outpoint);
        let Some(c) = self.recoveries.get(&key).cloned() else { return false };
        if c.signed_tx.is_some() {
            return true;
        }
        let (pubkey, ws) = { let o = self.offer(serial); (o.pk33(), o.witness_script.clone()) };
        match Self::accept_signature(&c, &pubkey, &ws, r) {
            Some(raw) => {
                let mut c2 = c;
                c2.signed_tx = Some(raw);
                self.recoveries.insert(key, c2);
                true
            }
            None => false,
        }
    }

    /// Retry a recovery signature with the same committed sighash.
    pub fn request_recovery_signature(&mut self, serial: u64, txid: String, vout: u32, value_sats: U64) -> Promise {
        let outpoint = Outpoint { txid: parse_hash_display(&txid), vout, value_sats: value_sats.0 };
        let c = self.recoveries.get(&(serial, outpoint.clone())).cloned().unwrap_or_else(|| env::panic_str("no such recovery"));
        require!(c.signed_tx.is_none(), "already signed");
        let path = self.offer(serial).path.clone();
        self.sign_promise(&path, c.sighash).then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SIGN).on_recovery_signed(serial, outpoint),
        )
    }

    // ───────────────────────────── buyer / payments ─────────────────────────────

    /// NEP-141 receiver. The only way USDC enters the contract.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.params.usdc, "only the pinned USDC contract");
        let m: TransferMsg = serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("bad msg"));
        let now = now_s();
        let network = self.params.network;
        let grace = self.params.grace_s;
        let cutoff = self.params.buy_cutoff_s;
        let min_conf = self.params.min_conf;
        let offer = self.offer_mut(m.serial);

        if !m.exercise {
            // Purchase. Final in this receipt.
            require!(offer.state == State::Funded, "offer is not for sale");
            require!(now + cutoff < offer.expiry_s, "too close to expiry");
            require!(amount.0 >= offer.premium_units, "amount below premium");
            let addr = m.btc_address.unwrap_or_else(|| env::panic_str("btc_address required"));
            let script = btc::script_from_address(&addr, network)
                .unwrap_or_else(|| env::panic_str("btc_address must be a v0 witness address for this network"));
            require!(btc::is_allowed_recipient_script(&script), "unsupported script");
            let premium = offer.premium_units;
            let seller = offer.seller.clone();
            offer.buyer = Some(sender_id.clone());
            offer.buyer_script = Some(script);
            offer.state = State::Sold;
            self.credit(&seller, premium);
            events::emit("sold", m.serial, serde_json::json!({ "buyer": sender_id, "premium_units": premium.to_string() }));
            return PromiseOrValue::Value(U128(amount.0 - premium));
        }

        // Exercise: pay the strike inside the window.
        require!(offer.state == State::Sold, "not exercisable in this state");
        require!(offer.buyer.as_ref() == Some(&sender_id), "only the buyer can exercise");
        require!(now >= offer.expiry_s, "exercise window not open");
        require!(now < offer.expiry_s + grace, "exercise window closed");
        require!(offer.commitment.is_none(), "already committed");
        let total = strike_total_units(offer.size_sats, offer.strike_units);
        require!(amount.0 >= total, "amount below strike");
        let proof = offer.deposit_proof.clone().unwrap_or_else(|| env::panic_str("no deposit proof"));
        offer.escrow_units = total;
        offer.state = State::ExercisePending;
        self.escrow_total += total;
        events::emit("exercise_pending", m.serial, serde_json::json!({ "strike_units": total.to_string() }));
        let excess = amount.0 - total;
        PromiseOrValue::Promise(self.lc_verify(&proof, min_conf).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_CB_SMALL.saturating_add(GAS_SIGN).saturating_add(GAS_CB_SIGN))
                .on_exercise_depth(m.serial, U128(excess), amount),
        ))
    }

    #[private]
    pub fn on_exercise_depth(
        &mut self,
        serial: u64,
        excess: U128,
        paid: U128,
        #[callback_result] r: Result<bool, PromiseError>,
    ) -> PromiseOrValue<U128> {
        let ok = matches!(r, Ok(true));
        let offer = self.offer_mut(serial);
        if offer.state != State::ExercisePending {
            // Cannot happen (no method leaves ExercisePending but this one); refund everything to be safe.
            return PromiseOrValue::Value(paid);
        }
        if !ok {
            let total = offer.escrow_units;
            offer.escrow_units = 0;
            offer.state = State::Sold;
            self.escrow_total -= total;
            events::emit("exercise_refused", serial, serde_json::json!({ "reason": "collateral depth" }));
            return PromiseOrValue::Value(paid);
        }
        // Commit now; the signature is requested in its own transaction (`request_signature`,
        // permissionless) because a `sign` call does not fit inside the token's call chain.
        self.commit(serial, Reason::Exercise);
        PromiseOrValue::Value(excess)
    }

    /// After the window: anyone settles an un-exercised offer back to the seller.
    pub fn settle(&mut self, serial: u64) -> Promise {
        let offer = self.offer(serial);
        require!(offer.state == State::Sold, "only a sold, un-exercised offer");
        require!(now_s() >= offer.expiry_s + self.params.grace_s, "exercise window still open");
        self.commit_and_sign(serial, Reason::Expiry)
    }

    /// Retry the signature for an existing commitment. Same sighash, always.
    pub fn request_signature(&mut self, serial: u64) -> Promise {
        let offer = self.offer(serial);
        require!(offer.state == State::Committed, "nothing to sign");
        let c = offer.commitment.as_ref().unwrap();
        require!(now_s() >= offer.retry_after_s.unwrap_or(0), "retry not due yet");
        let (path, sighash) = (offer.path.clone(), c.sighash);
        self.offer_mut(serial).retry_after_s = Some(now_s() + RETRY_DELAY_S);
        events::emit("signature_requested", serial, serde_json::json!({ "sighash": hex::encode(sighash) }));
        self.sign_promise(&path, sighash)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SIGN).on_signed(serial))
    }

    #[private]
    pub fn on_signed(&mut self, serial: u64, #[callback_result] r: Result<SignatureResponse, PromiseError>) -> bool {
        let offer = self.offer(serial);
        if offer.state != State::Committed {
            return offer.state == State::Signed; // late or duplicate: ignored
        }
        let c = offer.commitment.clone().unwrap();
        let pubkey = offer.pk33();
        let ws = offer.witness_script.clone();
        match Self::accept_signature(&c, &pubkey, &ws, r) {
            Some(raw) => {
                let offer = self.offer_mut(serial);
                let c = offer.commitment.as_mut().unwrap();
                c.signed_tx = Some(raw.clone());
                c.signed_at_s = Some(now_s());
                offer.state = State::Signed;
                offer.retry_after_s = None;
                events::emit("signed", serial, serde_json::json!({ "txid": btc::display_hex(&c.txid), "raw": hex::encode(raw) }));
                true
            }
            None => {
                let offer = self.offer_mut(serial);
                offer.retry_after_s = Some(now_s() + RETRY_DELAY_S);
                events::emit("sign_failed", serial, serde_json::json!({}));
                false
            }
        }
    }

    /// A signed settlement that has not been proven after `fee_bump_after_s`: anyone may have the same
    /// spend re-signed with double the fee (up to `max_fee_sats`). Same input, same single recipient;
    /// only the amount shrinks by the fee. Earlier versions stay valid.
    pub fn bump_fee(&mut self, serial: u64) -> Promise {
        let (max_fee, after) = (self.params.max_fee_sats, self.params.fee_bump_after_s);
        let offer = self.offer(serial);
        require!(offer.state == State::Signed, "only a signed, unproven settlement");
        let c = offer.commitment.as_ref().unwrap();
        require!(now_s() >= c.signed_at_s.unwrap_or(0) + after, "too early to bump");
        let fee = (c.fee_sats.saturating_mul(2)).min(max_fee);
        require!(fee > c.fee_sats, "fee already at the cap");
        let u = btc::build_spend(&c.outpoint, &offer.witness_script, &c.to_script, fee)
            .unwrap_or_else(|| env::panic_str("cannot build spend"));
        let path = offer.path.clone();
        let offer = self.offer_mut(serial);
        let c = offer.commitment.as_mut().unwrap();
        let old = c.txid;
        c.prior_txids.push(old);
        c.fee_sats = fee;
        c.amount_sats = u.amount_sats;
        c.unsigned_tx = bitcoin::consensus::serialize(&u.tx);
        c.sighash = u.sighash;
        c.txid = u.txid;
        c.signed_tx = None;
        c.signed_at_s = None;
        offer.state = State::Committed;
        offer.retry_after_s = Some(now_s() + RETRY_DELAY_S);
        events::emit("fee_bumped", serial, serde_json::json!({ "fee_sats": fee, "txid": btc::display_hex(&u.txid), "replaces": btc::display_hex(&old) }));
        self.sign_promise(&path, u.sighash)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SIGN).on_signed(serial))
    }

    /// Prove that a version of the committed transaction confirmed. Finalises the offer.
    pub fn confirm_spend(&mut self, serial: u64, proof: Proof) -> Promise {
        let offer = self.offer(serial);
        require!(matches!(offer.state, State::Signed | State::Committed), "nothing to confirm");
        let c = offer.commitment.as_ref().unwrap_or_else(|| env::panic_str("nothing to confirm"));
        let (txid, _) = self.parse_proof_tx(&proof);
        require!(txid == c.txid || c.prior_txids.contains(&txid), "proof is not for a committed version");
        require!(txid != c.txid || c.signed_tx.is_some(), "that version was never signed");
        let pref = ProofRef::from_proof(&proof, txid);
        self.lc_verify(&pref, self.params.min_conf)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SMALL).on_spend_verified(serial))
    }

    #[private]
    pub fn on_spend_verified(&mut self, serial: u64, #[callback_result] r: Result<bool, PromiseError>) -> bool {
        if !matches!(r, Ok(true)) {
            return false;
        }
        let offer = self.offer_mut(serial);
        if !matches!(offer.state, State::Signed | State::Committed) || offer.commitment.is_none() {
            return false;
        }
        let reason = offer.commitment.as_ref().unwrap().reason;
        let seller = offer.seller.clone();
        let buyer = offer.buyer.clone();
        let escrow = offer.escrow_units;
        offer.escrow_units = 0;
        offer.state = match reason {
            Reason::Withdraw => State::Withdrawn,
            Reason::Expiry => State::Kept,
            Reason::Exercise => State::Exercised,
            Reason::Recovery => unreachable!(),
        };
        self.open.remove(&serial);
        if escrow > 0 {
            self.escrow_total -= escrow;
            self.credit(&seller, escrow);
        }
        events::emit("spend_confirmed", serial, serde_json::json!({ "outcome": format!("{:?}", reason), "buyer": buyer }));
        true
    }

    /// Buyer reclaims an escrowed strike if delivery never confirmed.
    pub fn reclaim_strike(&mut self, serial: u64) {
        let timeout = self.params.escrow_timeout_s;
        let offer = self.offer_mut(serial);
        require!(offer.buyer.as_ref() == Some(&env::predecessor_account_id()), "only buyer");
        require!(offer.escrow_units > 0, "nothing in escrow");
        require!(matches!(offer.state, State::Committed | State::Signed), "not reclaimable in this state");
        let c = offer.commitment.as_ref().unwrap();
        require!(c.reason == Reason::Exercise, "not an exercise");
        require!(now_s() >= c.committed_at_s + timeout, "escrow timeout not reached");
        let amount = offer.escrow_units;
        let buyer = offer.buyer.clone().unwrap();
        offer.escrow_units = 0;
        self.escrow_total -= amount;
        self.credit(&buyer, amount);
        events::emit("strike_reclaimed", serial, serde_json::json!({ "units": amount.to_string() }));
    }

    /// Pull payment of everything owed to the caller.
    pub fn claim(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.claimable.get(&who).copied().unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.claimable.insert(who.clone(), 0);
        self.claimable_total -= amount;
        // NEP-145: a token like Circle's USDC only pays registered accounts. Register the payee
        // (refunded by the token if already registered), paid from the reserve each offer keeps.
        ext::ext_storage::ext(self.params.usdc.clone())
            .with_attached_deposit(self.params.usdc_storage_deposit)
            .with_static_gas(GAS_STORAGE_DEPOSIT)
            .storage_deposit(Some(who.clone()), Some(true))
            .then(ext_ft::ext(self.params.usdc.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(who.clone(), U128(amount), Some("coveredmarket claim".into())))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SMALL).on_claim(who, U128(amount)))
    }

    #[private]
    pub fn on_claim(&mut self, who: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            self.credit(&who, amount.0);
            events::emit("claim_failed", 0, serde_json::json!({ "account": who }));
            return false;
        }
        events::emit("claimed", 0, serde_json::json!({ "account": who, "units": amount.0.to_string() }));
        true
    }

    /// Live check of the whole signing path, as the contract itself calls it: ask the signer to sign a
    /// fixed constant under a reserved path (never an offer's `<account>/CV-<n>`, so its key holds no
    /// coins) and verify the answer against the key this contract derives for that path. Permissionless;
    /// the deploy script runs it before deleting the contract's key, and it can be re-run any time.
    pub fn selftest_sign(&mut self) -> Promise {
        let digest: [u8; 32] = near_sdk::env::sha256_array(b"coveredmarket selftest");
        self.sign_promise(SELFTEST_PATH, digest)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SMALL).on_selftest_signed())
    }

    #[private]
    pub fn on_selftest_signed(&mut self, #[callback_result] r: Result<SignatureResponse, PromiseError>) -> bool {
        let digest: [u8; 32] = near_sdk::env::sha256_array(b"coveredmarket selftest");
        let pk = derive::derive_pubkey(&self.root_key, &self.params.derivation_prefix, env::current_account_id().as_str(), SELFTEST_PATH)
            .unwrap_or_else(|| env::panic_str("derivation failed"));
        let ok = r.ok().and_then(|x| x.compact()).map(|sig| derive::verify_sig(&pk, &digest, &derive::normalize_low_s(&sig))).unwrap_or(false);
        events::emit("selftest_sign", 0, serde_json::json!({ "ok": ok }));
        ok
    }

    /// Anyone may top up the NEAR the contract attaches to `sign`.
    #[payable]
    pub fn fund(&mut self) {}

    // ───────────────────────────── views ─────────────────────────────

    pub fn get_params(&self) -> Params {
        self.params.clone()
    }

    pub fn get_offer(&self, serial: u64) -> Option<OfferView> {
        self.offers.get(&serial).map(|o| self.view(o))
    }

    pub fn get_offers(&self, from: u32, limit: u32) -> Vec<OfferView> {
        self.open.iter().skip(from as usize).take(limit as usize).map(|s| self.view(self.offer(*s))).collect()
    }

    /// Offers awaiting a deposit (for the relayer's address watch).
    pub fn get_created(&self, from: u32, limit: u32) -> Vec<OfferView> {
        self.created.iter().skip(from as usize).take(limit as usize).map(|s| self.view(self.offer(*s))).collect()
    }

    pub fn get_account_offers(&self, account: AccountId) -> Vec<OfferView> {
        match self.by_account.get(&account) {
            Some(v) => v.iter().map(|s| self.view(self.offer(*s))).collect(),
            None => vec![],
        }
    }

    pub fn get_address(&self, serial: u64) -> String {
        btc::address_for_script(&self.offer(serial).script_pubkey, self.params.network)
    }

    pub fn get_signed_tx(&self, serial: u64) -> Option<String> {
        self.offer(serial).commitment.as_ref().and_then(|c| c.signed_tx.as_ref()).map(hex::encode)
    }

    pub fn get_commitment(&self, serial: u64) -> Option<Commitment> {
        self.offer(serial).commitment.clone()
    }

    pub fn get_recovery(&self, serial: u64, txid: String, vout: u32, value_sats: U64) -> Option<Commitment> {
        let outpoint = Outpoint { txid: parse_hash_display(&txid), vout, value_sats: value_sats.0 };
        self.recoveries.get(&(serial, outpoint)).cloned()
    }

    pub fn get_claimable(&self, account: AccountId) -> U128 {
        U128(self.claimable.get(&account).copied().unwrap_or(0))
    }

    pub fn get_accounting(&self) -> Accounting {
        Accounting {
            claimable_total: U128(self.claimable_total),
            escrow_total: U128(self.escrow_total),
            near_balance: env::account_balance(),
            open_offers: self.open.len(),
        }
    }

    /// The MPC key this contract derives for `path` (compressed, hex). The deposit address also
    /// commits to the seller's rescue key and unlock time; see `get_offer().witness_script`.
    pub fn derive_key(&self, path: String) -> String {
        let pk = derive::derive_pubkey(&self.root_key, &self.params.derivation_prefix, env::current_account_id().as_str(), &path)
            .unwrap_or_else(|| env::panic_str("derivation failed"));
        hex::encode(pk)
    }
}

// ───────────────────────────── internals ─────────────────────────────

impl Offer {
    pub fn pk33(&self) -> [u8; 33] {
        self.derived_pubkey.as_slice().try_into().expect("33-byte key")
    }
}

impl Contract {
    fn offer(&self, serial: u64) -> &Offer {
        self.offers.get(&serial).unwrap_or_else(|| env::panic_str("no such offer"))
    }
    fn offer_mut(&mut self, serial: u64) -> &mut Offer {
        self.offers.get_mut(&serial).unwrap_or_else(|| env::panic_str("no such offer"))
    }
    fn index_account(&mut self, who: &AccountId, serial: u64) {
        if self.by_account.get(who).is_none() {
            let mut key = b"i".to_vec();
            key.extend_from_slice(who.as_bytes());
            self.by_account.insert(who.clone(), Vector::new(key));
        }
        self.by_account.get_mut(who).unwrap().push(serial);
    }
    /// Charge the caller for the storage just used plus `reserve` (kept, e.g. to register a payee), refund the rest.
    fn charge_storage(&self, before: u64, reserve: NearToken) {
        let used = env::storage_usage().saturating_sub(before);
        let cost = env::storage_byte_cost().saturating_mul(used as u128).saturating_add(reserve);
        require!(env::attached_deposit() >= cost, "attach storage deposit");
        let refund = env::attached_deposit().saturating_sub(cost);
        if refund.as_yoctonear() > 0 {
            let _ = Promise::new(env::predecessor_account_id()).transfer(refund);
        }
    }
    fn credit(&mut self, who: &AccountId, units: u128) {
        let cur = self.claimable.get(who).copied().unwrap_or(0);
        self.claimable.insert(who.clone(), cur + units);
        self.claimable_total += units;
    }
    fn parse_proof_tx(&self, proof: &Proof) -> ([u8; 32], Vec<(u32, u64, Vec<u8>)>) {
        let raw = hex::decode(&proof.tx_raw).unwrap_or_else(|_| env::panic_str("tx_raw must be hex"));
        btc::parse_tx(&raw).unwrap_or_else(|| env::panic_str("tx_raw does not parse"))
    }
    /// Near-One light client `verify_transaction_inclusion_v2(ProofArgsV2)`, args borsh-encoded.
    fn lc_verify(&self, p: &ProofRef, confirmations: u64) -> Promise {
        Promise::new(self.params.light_client.clone()).function_call(
            "verify_transaction_inclusion_v2".to_string(),
            p.borsh_args(confirmations),
            NearToken::from_yoctonear(0),
            GAS_LC_VERIFY,
        )
    }
    fn sign_promise(&self, path: &str, sighash: [u8; 32]) -> Promise {
        let args = ext::sign_args(self.params.sign_format, path, &sighash);
        Promise::new(self.params.signer.clone()).function_call(
            "sign".to_string(),
            args,
            self.params.sign_deposit,
            GAS_SIGN,
        )
    }

    fn commit_and_sign(&mut self, serial: u64, reason: Reason) -> Promise {
        self.commit(serial, reason);
        let offer = self.offer(serial);
        let sighash = offer.commitment.as_ref().unwrap().sighash;
        self.sign_promise(&offer.path, sighash)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CB_SIGN).on_signed(serial))
    }

    /// Build the commitment (once) and store it. Signature requests always use this stored sighash.
    fn commit(&mut self, serial: u64, reason: Reason) {
        let fee = self.params.fee_sats;
        let half_delay = self.params.rescue_delay_s / 2;
        let offer = self.offer_mut(serial);
        require!(offer.commitment.is_none(), "already committed");
        // Leave the settlement at least half the rescue delay to confirm (and be bumped) before the
        // seller's exit opens; after that the seller simply uses the exit.
        require!(now_s() + half_delay < offer.unlock_s, "too close to the rescue unlock; the seller's exit applies");
        let collateral = offer.collateral.clone().unwrap_or_else(|| env::panic_str("no collateral"));
        let to_script = match reason {
            Reason::Exercise => offer.buyer_script.clone().unwrap_or_else(|| env::panic_str("no buyer script")),
            _ => offer.refund_script.clone(),
        };
        let u = btc::build_spend(&collateral, &offer.witness_script, &to_script, fee)
            .unwrap_or_else(|| env::panic_str("cannot build spend"));
        let c = Commitment {
            reason,
            outpoint: collateral,
            to_script,
            amount_sats: u.amount_sats,
            unsigned_tx: bitcoin::consensus::serialize(&u.tx),
            sighash: u.sighash,
            txid: u.txid,
            signed_tx: None,
            committed_at_s: now_s(),
            fee_sats: fee,
            prior_txids: vec![],
            signed_at_s: None,
        };
        offer.commitment = Some(c);
        offer.state = State::Committed;
        // Exercise: signature may be requested immediately; withdraw/settle request it in the same tx and retry after a delay.
        offer.retry_after_s = Some(if reason == Reason::Exercise { now_s() } else { now_s() + RETRY_DELAY_S });
        events::emit(
            "committed",
            serial,
            serde_json::json!({ "reason": format!("{:?}", reason), "txid": btc::display_hex(&u.txid), "sighash": hex::encode(u.sighash) }),
        );
    }

    /// Verify the MPC's signature against the derived key for the committed
    /// sighash; return the final raw transaction if it is good.
    fn accept_signature(c: &Commitment, pubkey: &[u8; 33], witness_script: &[u8], r: Result<SignatureResponse, PromiseError>) -> Option<Vec<u8>> {
        let resp = r.ok()?;
        let sig = derive::normalize_low_s(&resp.compact()?);
        if !derive::verify_sig(pubkey, &c.sighash, &sig) {
            return None;
        }
        let unsigned: bitcoin::Transaction = bitcoin::consensus::deserialize(&c.unsigned_tx).ok()?;
        let u = btc::Unsigned { tx: unsigned, txid: c.txid, sighash: c.sighash, amount_sats: c.amount_sats };
        Some(btc::finalize(&u, &sig, witness_script))
    }

    fn view(&self, o: &Offer) -> OfferView {
        let net = self.params.network;
        let c = o.commitment.as_ref();
        OfferView {
            serial: o.serial,
            seller: o.seller.clone(),
            buyer: o.buyer.clone(),
            size_sats: U64(o.size_sats),
            strike_units: U128(o.strike_units),
            strike_total_units: U128(strike_total_units(o.size_sats, o.strike_units)),
            premium_units: U128(o.premium_units),
            expiry_s: U64(o.expiry_s),
            created_s: U64(o.created_s),
            path: o.path.clone(),
            derived_pubkey: hex::encode(&o.derived_pubkey),
            rescue_pubkey: hex::encode(&o.rescue_pubkey),
            unlock_s: U64(o.unlock_s),
            witness_script: hex::encode(&o.witness_script),
            address: btc::address_for_script(&o.script_pubkey, net),
            refund_address: btc::address_for_script(&o.refund_script, net),
            buyer_address: o.buyer_script.as_ref().map(|s| btc::address_for_script(s, net)),
            collateral_txid: o.collateral.as_ref().map(|c| btc::display_hex(&c.txid)),
            collateral_vout: o.collateral.as_ref().map(|c| c.vout),
            collateral_value_sats: o.collateral.as_ref().map(|c| U64(c.value_sats)),
            commitment_reason: c.map(|c| c.reason),
            commitment_txid: c.map(|c| btc::display_hex(&c.txid)),
            commitment_sighash: c.map(|c| hex::encode(c.sighash)),
            commitment_to_address: c.map(|c| btc::address_for_script(&c.to_script, net)),
            commitment_amount_sats: c.map(|c| U64(c.amount_sats)),
            committed_at_s: c.map(|c| U64(c.committed_at_s)),
            commitment_fee_sats: c.map(|c| U64(c.fee_sats)),
            prior_txids: c.map(|c| c.prior_txids.iter().map(btc::display_hex).collect()).unwrap_or_default(),
            signed_at_s: c.and_then(|c| c.signed_at_s).map(U64),
            signed_tx: c.and_then(|c| c.signed_tx.as_ref()).map(hex::encode),
            escrow_units: U128(o.escrow_units),
            retry_after_s: o.retry_after_s.map(U64),
            state: o.state.clone(),
        }
    }
}

/// Parse a display-order (big-endian) hex hash into internal byte order.
pub fn parse_hash_display(s: &str) -> [u8; 32] {
    let v = hex::decode(s).unwrap_or_else(|_| env::panic_str("bad hash hex"));
    let mut a: [u8; 32] = v.try_into().unwrap_or_else(|_| env::panic_str("hash must be 32 bytes"));
    a.reverse();
    a
}

#[cfg(test)]
mod tests;
