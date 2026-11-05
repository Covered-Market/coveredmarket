# Builds the four contracts to wasm with cargo-near (non-reproducible is fine for local).
FROM rust:bookworm AS build
RUN rustup target add wasm32-unknown-unknown && curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY integration ./integration
RUN for c in covered mock-signer mock-btc-client mock-usdc; do cargo near build non-reproducible-wasm --manifest-path contracts/$c/Cargo.toml; done
FROM alpine:3.20
COPY --from=build /build/target/near /build/target/near
