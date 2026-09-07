#!/bin/bash
# Deploy Telegraph Duel program to local validator

set -e

cd "$(dirname "$0")/.."

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
echo "📝 Program ID: HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM"
echo ""
