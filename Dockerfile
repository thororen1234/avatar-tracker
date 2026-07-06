FROM node:lts-slim
WORKDIR /app

RUN npm install -g pnpm@latest
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
RUN pnpm install

COPY . .

CMD ["pnpm", "start"]
