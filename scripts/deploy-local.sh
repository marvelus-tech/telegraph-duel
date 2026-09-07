#!/bin/bash

# Deploy Telegraph Duel program to local validator

set -e

echo "🔨 Building Telegraph Duel program..."
anchor build

echo ""
echo "📦 Deploying to local validator..."

# Set to local cluster
solana config set --url localhost

# Deploy
anchor deploy

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Program ID: Du3LCxxx1111111111111111111111111111111111"
echo ""
