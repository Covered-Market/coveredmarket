FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --silent
COPY testnet.ts ./
CMD ["npx", "tsx", "testnet.ts"]
