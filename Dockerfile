FROM ghcr.io/puppeteer/puppeteer:latest

USER root
RUN npm install -g pnpm@latest
USER pptruser
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer
WORKDIR /home/pptruser/app

COPY --chown=pptruser:pptruser package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

RUN pnpm install

COPY --chown=pptruser:pptruser . .

CMD ["pnpm", "start"]
