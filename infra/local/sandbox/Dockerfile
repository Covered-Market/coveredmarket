# NEAR sandbox node (the same neard-sandbox binary near-workspaces uses): one validator, fast blocks.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/* \
 && npm i -g near-sandbox@0.3.5 && useradd -m near
USER near
WORKDIR /home/near
# first call downloads the binary and initialises the chain (validator key = test.near)
RUN near-sandbox --home /home/near/.near init --chain-id localnet
EXPOSE 3030
CMD ["near-sandbox", "--home", "/home/near/.near", "run", "--rpc-addr", "0.0.0.0:3030"]
