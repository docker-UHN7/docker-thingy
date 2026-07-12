FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install --omit=dev serve

COPY --from=build /app/dist ./dist

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD curl -f http://localhost:3001/ || exit 1

CMD ["npx", "serve", "-s", "dist", "-l", "3001"]