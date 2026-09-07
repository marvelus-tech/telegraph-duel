#!/bin/bash

# Set up Telegraph Duel on devnet
# This script deploys the program to devnet for testing

set -e

echo "🌐 Setting up Telegraph Duel on Devnet..."

# Switch to devnet
solana config set --url devnet

echo ""
echo "💰 Checking wallet balance..."

BALANCE=$(solana balance | awk '{print $1}')
if (( $(echo "$BALANCE < 2" | bc -l) )); then
  echo "   Low balance: $BALANCE SOL"
  echo "   Requesting airdrop..."
  solana airdrop 2
  sleep 2
fi

echo "   Balance: $(solana balance)"
echo ""

echo "🔨 Building program..."
anchor build

echo ""
echo "📦 Deploying to devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "✅ Devnet deployment complete!"
echo ""
echo "🔍 View on Solana Explorer:"
echo "   https://explorer.solana.com/address/Du3LCxxx1111111111111111111111111111111111?cluster=devnet"
echo ""
