#!/usr/bin/env node
/**
 * Demo script for match-server to Solana bridge
 * 
 * Usage:
 *   npm run dev                          # Generate test wallets and prompt for roomId
 *   npm run dev -- --room rm_abc123      # Use specific room ID
 *   npm run dev -- --poll rm_1,rm_2      # Poll multiple rooms
 */

import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { MatchServerBridge } from './bridge.js';
import { createTestConfig, loadConfig } from './config.js';
import * as readline from 'readline';

// Parse command line args
const args = process.argv.slice(2);
const roomArg = args.find(arg => arg.startsWith('--room='));
const pollArg = args.find(arg => arg.startsWith('--poll='));
const useEnv = args.includes('--env');

const roomId = roomArg?.split('=')[1];
const pollRoomIds = pollArg?.split('=')[1]?.split(',');

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Match Server → Solana Bridge Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  let config;
  let feePayerKeypair;
  let agentKeypairs;

  if (useEnv) {
    console.log('[Demo] Loading configuration from .env file...');
    const envConfig = loadConfig();
    config = envConfig;
    feePayerKeypair = envConfig.feePayerKeypair;
  } else {
    console.log('[Demo] Generating test configuration...');
    
    // Prompt for agent IDs
    const agentIdsInput = await prompt('Enter agent IDs (comma-separated, e.g., alice,bob): ');
    const agentIds = agentIdsInput.split(',').map(id => id.trim()).filter(Boolean);
    
    if (agentIds.length === 0) {
      console.error('[Demo] No agent IDs provided. Using defaults: agent-a, agent-b');
      agentIds.push('agent-a', 'agent-b');
    }

    const testConfig = createTestConfig({ agentIds });
    config = testConfig;
    feePayerKeypair = testConfig.feePayerKeypair;
    agentKeypairs = testConfig.agentKeypairs;

    console.log('\n[Demo] Test wallets generated:');
    console.log(`  Fee payer: ${feePayerKeypair.publicKey.toBase58()}`);
    for (const [agentId, keypair] of agentKeypairs) {
      console.log(`  ${agentId}: ${keypair.publicKey.toBase58()}`);
    }
    console.log();
  }

  console.log('[Demo] Configuration:');
  console.log(`  RPC: ${config.solanaRpcUrl}`);
  console.log(`  Match Server: ${config.matchServerUrl}`);
  console.log(`  Program ID: ${config.programId.toBase58()}`);
  console.log(`  Agent Wallets: ${config.agentWallets.size} configured`);
  console.log();

  // Check fee payer balance
  const connection = new Connection(config.solanaRpcUrl, 'confirmed');
  const balance = await connection.getBalance(feePayerKeypair.publicKey);
  console.log(`[Demo] Fee payer balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance === 0) {
    console.warn('[Demo] ⚠️  Fee payer has no SOL! Airdrop required for localnet:');
    console.warn(`       solana airdrop 10 ${feePayerKeypair.publicKey.toBase58()} --url ${config.solanaRpcUrl}`);
    console.log();
  }

  // Create bridge
  const bridge = new MatchServerBridge(config);

  // Listen for score.settled events
  bridge.on('score.settled', (event) => {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 Score Settled Event');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Room ID: ${event.payload.roomId}`);
    console.log(`Winner: ${event.payload.winnerAgentId} (seat ${event.payload.winnerSeat})`);
    console.log(`Scores: ${event.payload.agentIdA} (${event.payload.finalScoresA}) vs ${event.payload.agentIdB} (${event.payload.finalScoresB})`);
    if (event.payload.lastClashReason) {
      console.log(`Last Clash: ${event.payload.lastClashReason}`);
    }
    console.log(`TX Sig: ${event.payload.txSig}`);
    console.log(`Score PDAs:`);
    console.log(`  A: ${event.payload.scorePdaA}`);
    console.log(`  B: ${event.payload.scorePdaB}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  // Handle different modes
  if (pollRoomIds) {
    console.log(`[Demo] Polling mode: monitoring rooms ${pollRoomIds.join(', ')}`);
    console.log('[Demo] Press Ctrl+C to stop\n');
    bridge.startPolling(pollRoomIds);
    
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n[Demo] Stopping...');
      bridge.stopPolling();
      process.exit(0);
    });
  } else {
    // Single room settlement
    let targetRoomId = roomId;
    if (!targetRoomId) {
      targetRoomId = await prompt('Enter room ID to settle: ');
    }

    if (!targetRoomId) {
      console.error('[Demo] No room ID provided');
      process.exit(1);
    }

    console.log(`[Demo] Processing room: ${targetRoomId}\n`);
    await bridge.processRoom(targetRoomId);
    
    console.log('\n[Demo] Done!');
  }
}

main().catch((error) => {
  console.error('[Demo] Fatal error:', error);
  process.exit(1);
});
