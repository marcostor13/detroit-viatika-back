# Stage 1: Build
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json .
RUN npm install --force
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-slim
WORKDIR /app
COPY package*.json .
RUN npm install --omit=dev --force
COPY --from=build /app/dist ./dist
EXPOSE 3016
CMD ["node", "dist/main.js"]
