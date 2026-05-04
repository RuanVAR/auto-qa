#!/usr/bin/env bash
set -e

COMPOSE="docker compose -f docker/dev/docker-compose.yml"

echo "▶  Starting dev containers..."
$COMPOSE up --build -d

echo "⏳  Waiting for API to be healthy..."
until $COMPOSE exec -T api sh -c 'cd apps/api && pnpm exec prisma migrate deploy' > /dev/null 2>&1; do
  sleep 3
done

echo "🗄   Running migrations..."
$COMPOSE exec -T api sh -c 'cd apps/api && pnpm exec prisma migrate deploy'

echo "🌱  Seeding database..."
$COMPOSE exec -T api sh -c 'cd apps/api && pnpm exec prisma db seed'

echo ""
echo "✅  Dev environment ready!"
echo ""
echo "   App    → http://localhost:3000"
echo "   API    → http://localhost:3001"
echo ""
echo "   Login (password: Demo123!)"
echo "   Platform admin  →  ruanv@openvantage.co.za"
echo "   Demo org admin  →  ruan15viljoen@gmail.com"
echo ""
