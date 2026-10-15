FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY shared ./shared
COPY server ./server
COPY client ./client
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/index.js"]
