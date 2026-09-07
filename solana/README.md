# Solana Integration

Reserved for Dex's Solana plumbing (wallets, on-chain state, transactions).

Game logic lives in `src/` - this subtree is for blockchain integration only.

## Integration Point

Subscribe to game events via the EventBus exported from `src/bus/EventBus.ts`.

See `EVENTBUS.md` in the root for the complete event contract.
