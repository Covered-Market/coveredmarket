# Builds the four contracts to wasm with cargo-near (non-reproducible is fine for local).
FROM rust:bookworm AS build
# clang: secp256k1-sys compiles C for wasm32
RUN apt-get update && apt-get install -y --no-install-recommends clang && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown && curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY integration ./integration
RUN set -e; for c in covered mock-signer mock-btc-client mock-usdc; do cargo near build non-reproducible-wasm --manifest-path contracts/$c/Cargo.toml; done; ls target/near/*/*.wasm
FROM alpine:3.20
COPY --from=build /build/target/near /build/target/near
