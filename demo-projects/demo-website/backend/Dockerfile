FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "server.js"]