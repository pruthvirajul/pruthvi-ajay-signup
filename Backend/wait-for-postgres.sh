#!/bin/bash
# wait-for-postgres.sh

set -e

# Use environment variables from docker-compose.yml
host="${DB_HOST:-postgres}"
port="${DB_PORT:-5432}"
user="${DB_USER:-postgres}"
password="${DB_PASSWORD:-admin321}"

# Wait until PostgreSQL is ready
until PGPASSWORD="$password" psql -h "$host" -p "$port" -U "$user" -d postgres -c '\q' 2>/dev/null; do
  >&2 echo "Postgres is unavailable at $host:$port - sleeping"
  sleep 1
done

>&2 echo "Postgres is up at $host:$port - executing command"
exec "$@"
