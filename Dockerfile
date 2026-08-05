FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native compile
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ ./

# Data directory for the SQLite file (mounted as a volume in docker-compose)
RUN mkdir -p /app/data

# Run as an unprivileged user rather than root.
# NOTE for existing deployments: if you're redeploying onto a `vehicle_loan_data` volume that
# was already written to by a previous (root) container, that data is owned by root and this
# new non-root user won't be able to write to it. Fix once with:
#   docker compose run --rm -u root vehicle-loan-app chown -R appuser:appuser /app/data
RUN groupadd -r appuser && useradd -r -g appuser -d /app appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
