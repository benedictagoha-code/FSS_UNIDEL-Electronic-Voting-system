FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund     && npm cache clean --force

COPY --chown=node:node . .

USER node
EXPOSE 3000

# Run tracked, transactional migrations before every process start.
# The migration runner skips versions already recorded in schema_migrations.
CMD ["sh", "-c", "npm run db:migrate && npm start"]
