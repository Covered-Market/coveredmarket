# NEAR sandbox node (the same neard-sandbox binary near-workspaces uses): one validator, fast blocks.
FROM node:22-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/* && useradd -m near
USER near
WORKDIR /home/near
# installed in the user's home so the first run can download the binary next to the package
RUN npm init -y >/dev/null && npm i near-sandbox@0.3.5 --silent
ENV PATH="/home/near/node_modules/.bin:${PATH}"
RUN near-sandbox --home /home/near/.near init --chain-id localnet
EXPOSE 3030
CMD ["near-sandbox", "--home", "/home/near/.near", "run", "--rpc-addr", "0.0.0.0:3030"]
