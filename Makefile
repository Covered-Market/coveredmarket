.PHONY: test build e2e regtest
test:            ## L0: native unit tests
	cargo test -p covered
build:           ## wasm for the three contracts (needs wasm32 target or cargo-near)
	cargo near build non-reproducible-wasm --manifest-path contracts/covered/Cargo.toml
	cargo near build non-reproducible-wasm --manifest-path contracts/mock-signer/Cargo.toml
	cargo near build non-reproducible-wasm --manifest-path contracts/mock-btc-client/Cargo.toml
e2e: build       ## L1: sandbox integration (needs near-sandbox; fixtures/fungible_token.wasm)
	cargo test -p integration -- --test-threads=1
regtest:         ## L1b: real Bitcoin regtest round trip of a signed tx
	bash scripts/regtest.sh
