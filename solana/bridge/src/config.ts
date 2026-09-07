import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';
import type { BridgeConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load configuration from environment variables
 * Reads .env file if present
 */
export function loadConfig(): BridgeConfig & { feePayerKeypair: Keypair } {
  // Load .env file if it exists
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath });
  }

  const solanaRpcUrl = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
  const matchServerUrl = process.env.MATCH_SERVER_URL || 'https://telegraph-duel-match-server.marvelus.workers.dev';
  const programIdStr = process.env.PROGRAM_ID || 'HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM';
  const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

  // Parse agent wallet map
  const agentWallets = new Map<string, PublicKey>();
  const agentWalletMapStr = process.env.AGENT_WALLET_MAP || '';
  
  if (agentWalletMapStr) {
    const mappings = agentWalletMapStr.split(',');
    for (const mapping of mappings) {
      const [agentId, walletStr] = mapping.split(':');
      if (agentId && walletStr) {
        try {
          // Try parsing as keypair first (base58 private key)
          let publicKey: PublicKey;
          try {
            const keypair = Keypair.fromSecretKey(
              Buffer.from(walletStr, 'base64')
            );
            publicKey = keypair.publicKey;
          } catch {
            // If not a keypair, treat as public key
            publicKey = new PublicKey(walletStr);
          }
          agentWallets.set(agentId.trim(), publicKey);
        } catch (error) {
          console.warn(`[Config] Invalid wallet for agent ${agentId}: ${error}`);
        }
      }
    }
  }

  // Load fee payer keypair
  let feePayerKeypair: Keypair;
  const feePayerPrivateKey = process.env.FEE_PAYER_PRIVATE_KEY;
  
  if (!feePayerPrivateKey) {
    console.warn('[Config] FEE_PAYER_PRIVATE_KEY not set, generating temporary keypair');
    console.warn('[Config] This wallet needs SOL for transaction fees!');
    feePayerKeypair = Keypair.generate();
  } else {
    try {
      feePayerKeypair = Keypair.fromSecretKey(
        Buffer.from(feePayerPrivateKey, 'base64')
      );
    } catch (error) {
      throw new Error(`Invalid FEE_PAYER_PRIVATE_KEY: ${error}`);
    }
  }

  const config: BridgeConfig = {
    solanaRpcUrl,
    matchServerUrl,
    agentWallets,
    feePayerKeypair,
    programId: new PublicKey(programIdStr),
    pollIntervalMs,
    publishSettlementEvents: process.env.PUBLISH_SETTLEMENT_EVENTS === 'true',
  };

  return config;
}

/**
 * Create a test configuration with generated keypairs
 */
export function createTestConfig(options: {
  agentIds: string[];
  solanaRpcUrl?: string;
  matchServerUrl?: string;
}): BridgeConfig & { agentKeypairs: Map<string, Keypair> } {
  const agentKeypairs = new Map<string, Keypair>();
  const agentWallets = new Map<string, PublicKey>();

  // Generate keypairs for each agent
  for (const agentId of options.agentIds) {
    const keypair = Keypair.generate();
    agentKeypairs.set(agentId, keypair);
    agentWallets.set(agentId, keypair.publicKey);
  }

  const feePayerKeypair = Keypair.generate();

  return {
    solanaRpcUrl: options.solanaRpcUrl || 'http://127.0.0.1:8899',
    matchServerUrl: options.matchServerUrl || 'https://telegraph-duel-match-server.marvelus.workers.dev',
    agentWallets,
    feePayerKeypair,
    programId: new PublicKey('HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM'),
    pollIntervalMs: 5000,
    publishSettlementEvents: process.env.PUBLISH_SETTLEMENT_EVENTS === 'true',
    agentKeypairs,
  };
}
