//! L1 stand-in for the Near-One Bitcoin light client: same method name and borsh argument layout
//! (`verify_transaction_inclusion_v2(ProofArgsV2)`), but the test says which (txid, block) pairs
//! exist and at what depth instead of tracking real headers.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::store::LookupMap;
use near_sdk::{near, PanicOnDefault};

#[derive(BorshSerialize, BorshDeserialize)]
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

fn display(h: &[u8; 32]) -> String { let mut v = *h; v.reverse(); v.iter().map(|b| format!("{b:02x}")).collect() }

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockBtcClient { included: LookupMap<String, u64>, stale: bool }

#[near]
impl MockBtcClient {
    #[init]
    pub fn new() -> Self { Self { included: LookupMap::new(b"i"), stale: false } }
    /// tx_id and block_hash in display hex.
    pub fn set_included(&mut self, tx_id: String, block_hash: String, depth: u64) {
        self.included.insert(format!("{tx_id}:{block_hash}"), depth);
    }
    pub fn set_stale(&mut self, stale: bool) { self.stale = stale; }
    pub fn verify_transaction_inclusion_v2(&self, #[serializer(borsh)] args: ProofArgsV2) -> bool {
        if self.stale { return false; }
        let key = format!("{}:{}", display(&args.tx_id), display(&args.tx_block_blockhash));
        self.included.get(&key).map(|d| *d >= args.confirmations).unwrap_or(false)
    }
}
