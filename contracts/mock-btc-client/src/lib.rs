//! L1 stand-in for the Bitcoin light client: the test tells it which
//! (txid, block hash) pairs exist and at what depth. Same method shape as the
//! pinned upstream interface.
use near_sdk::store::LookupMap;
use near_sdk::{near, PanicOnDefault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockBtcClient { included: LookupMap<String, u64>, stale: bool }

#[near]
impl MockBtcClient {
    #[init]
    pub fn new() -> Self { Self { included: LookupMap::new(b"i"), stale: false } }
    pub fn set_included(&mut self, tx_id: String, block_hash: String, depth: u64) {
        self.included.insert(format!("{tx_id}:{block_hash}"), depth);
    }
    pub fn set_stale(&mut self, stale: bool) { self.stale = stale; }
    pub fn verify_transaction_inclusion(&self, tx_id: String, tx_block_blockhash: String, tx_index: u64, merkle_proof: Vec<String>, confirmations: u64) -> bool {
        let _ = (tx_index, merkle_proof);
        if self.stale { return false; }
        self.included.get(&format!("{tx_id}:{tx_block_blockhash}")).map(|d| *d >= confirmations).unwrap_or(false)
    }
}
