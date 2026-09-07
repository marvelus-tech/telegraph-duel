#!/bin/bash

# Start a local Solana validator for testing Telegraph Duel
# This script sets up a local validator with appropriate configuration

set -e

echo "🚀 Starting Solana Test Validator..."

# Kill any existing validator
pkill -f solana-test-validator || true
sleep 2

# Start the validator
solana-test-validator \
  --reset \
  --quiet \
  --ledger .ledger \
  --log .ledger/validator.log \
  --rpc-port 8899 \
  --faucet-port 9900 \
  --limit-ledger-size 100000000 \
  &

VALIDATOR_PID=$!

echo "   Validator PID: $VALIDATOR_PID"
echo "   RPC: http://127.0.0.1:8899"
echo "   Faucet: http://127.0.0.1:9900"
echo ""
echo "   Waiting for validator to be ready..."

# Wait for validator to be ready
for i in {1..30}; do
  if solana cluster-version --url http://127.0.0.1:8899 &>/dev/null; then
    echo "   ✅ Validator ready!"
    break
  fi
  
  if [ $i -eq 30 ]; then
    echo "   ❌ Validator failed to start"
    exit 1
  fi
  
  sleep 1
done

echo ""
echo "📝 Validator is running. Use 'pkill -f solana-test-validator' to stop."
echo ""

# Keep the script running
wait $VALIDATOR_PID
