FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --silent
COPY bootstrap.ts ./
CMD ["npx", "tsx", "bootstrap.ts"]
