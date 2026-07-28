FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native compile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ ./

# Data directory for the SQLite file (mounted as a volume in docker-compose)
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
