FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY simulator ./simulator
COPY public ./public
COPY scripts ./scripts
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
