# Builds the four contracts to wasm with cargo-near (non-reproducible is fine for local).
FROM rust:bookworm AS build
# clang: secp256k1-sys compiles C for wasm32. pkg-config + libudev-dev: building cargo-near from source (arm64).
RUN apt-get update && apt-get install -y --no-install-recommends clang pkg-config libudev-dev && rm -rf /var/lib/apt/lists/*
# cargo-near ships a prebuilt binary for x86-64 Linux only. On arm64 (Docker on an Apple Silicon Mac) build it
# from source: same version, a few extra minutes on the first `bin/covered up`.
ARG CARGO_NEAR=0.23.0
RUN rustup target add wasm32-unknown-unknown && \
    if [ "$(uname -m)" = "x86_64" ]; then \
      curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/download/cargo-near-v$CARGO_NEAR/cargo-near-installer.sh | sh; \
    else \
      cargo install cargo-near --version $CARGO_NEAR --locked; \
    fi && command -v cargo-near
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY integration ./integration
RUN set -e; for c in covered mock-signer mock-btc-client mock-usdc; do cargo near build non-reproducible-wasm --manifest-path contracts/$c/Cargo.toml; done; ls target/near/*/*.wasm
FROM alpine:3.20
COPY --from=build /build/target/near /build/target/near
