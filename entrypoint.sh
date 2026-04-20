#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --accept-data-loss

echo "Seeding sample data..."
npx tsx src/server/seed/seedDatabase.ts

echo "Starting app..."
exec npx next start
