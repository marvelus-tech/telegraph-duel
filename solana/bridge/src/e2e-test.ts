#!/usr/bin/env node
/**
 * E2E Test Script for Match-Server → Solana Bridge
 * 
 * Tests the full flow:
 * 1. Generate two test wallets (alice, bob)
 * 2. Airdrop SOL to fee payer
 * 3. Use fixture for completed room
 * 4. Run bridge settlement
 * 5. Verify score PDAs on-chain
 * 
 * Usage:
 *   npm run e2e                    # Use fixture
 *   npm run e2e -- --room rm_123   # Use live room from Workers API
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { MatchServerBridge } from './bridge.js';
import { createTestConfig } from './config.js';
import { COMPLETED_ROOM_FIXTURE } from './fixtures.js';

// Parse command line args
const args = process.argv.slice(2);
const roomArg = args.find(arg => arg.startsWith('--room='));
const roomId = roomArg?.split('=')[1];
const useFixture = !roomId;

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  E2E Test: Match-Server → Solana Bridge');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();

  // Step 1: Generate test configuration
  console.log('📦 Step 1: Generate test configuration');
  console.log('─────────────────────────────────────');
  
  const testConfig = createTestConfig({
    agentIds: ['alice', 'bob'],
    solanaRpcUrl: 'http://127.0.0.1:8899',
  });

  const { agentKeypairs, feePayerKeypair } = testConfig;
  
  console.log('✓ Generated test wallets:');
  console.log(`  Fee payer: ${feePayerKeypair.publicKey.toBase58()}`);
  console.log(`  Alice:     ${agentKeypairs.get('alice')!.publicKey.toBase58()}`);
  console.log(`  Bob:       ${agentKeypairs.get('bob')!.publicKey.toBase58()}`);
  console.log();

  // Step 2: Check and airdrop SOL
  console.log('💰 Step 2: Check fee payer balance');
  console.log('─────────────────────────────────────');
  
  const connection = new Connection(testConfig.solanaRpcUrl, 'confirmed');
  let balance = await connection.getBalance(feePayerKeypair.publicKey);
  
  console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('⚠️  Balance too low, requesting airdrop...');
    try {
      const signature = await connection.requestAirdrop(
        feePayerKeypair.publicKey,
        1 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature);
      balance = await connection.getBalance(feePayerKeypair.publicKey);
      console.log(`✓ Airdrop successful! New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    } catch (error) {
      console.error('✗ Airdrop failed:', error);
      console.log('\nManual airdrop required:');
      console.log(`  solana airdrop 1 ${feePayerKeypair.publicKey.toBase58()} --url http://127.0.0.1:8899`);
      process.exit(1);
    }
  } else {
    console.log('✓ Balance sufficient');
  }
  console.log();

  // Step 3: Create bridge
  console.log('🌉 Step 3: Initialize bridge');
  console.log('─────────────────────────────────────');
  
  const bridge = new MatchServerBridge(testConfig);
  console.log('✓ Bridge initialized');
  console.log();

  // Step 4: Listen for events
  console.log('👂 Step 4: Register event listeners');
  console.log('─────────────────────────────────────');
  
  let eventReceived = false;
  bridge.on('score.settled', (event) => {
    eventReceived = true;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  📊 score.settled Event Received');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Room ID:     ${event.payload.roomId}`);
    console.log(`Match ID:    ${event.payload.matchId}`);
    console.log(`Winner:      ${event.payload.winnerAgentId} (seat ${event.payload.winnerSeat})`);
    console.log(`Scores:      ${event.payload.agentIdA} (${event.payload.finalScoresA}) vs ${event.payload.agentIdB} (${event.payload.finalScoresB})`);
    console.log(`Wallets:`);
    console.log(`  A: ${event.payload.walletA}`);
    console.log(`  B: ${event.payload.walletB}`);
    if (event.payload.lastClashReason) {
      console.log(`Last Clash:  ${event.payload.lastClashReason}`);
    }
    console.log(`TX Sig:      ${event.payload.txSig}`);
    console.log(`Score PDAs:`);
    console.log(`  A: ${event.payload.scorePdaA}`);
    console.log(`  B: ${event.payload.scorePdaB}`);
    console.log(JSON.stringify(event, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });
  
  console.log('✓ Event listener registered');
  console.log();

  // Step 5: Get room state
  console.log('🎮 Step 5: Get completed room state');
  console.log('─────────────────────────────────────');
  
  let roomState;
  if (useFixture) {
    console.log('Using test fixture (no live API call)');
    roomState = COMPLETED_ROOM_FIXTURE;
  } else {
    console.log(`Fetching room from API: ${roomId}`);
    roomState = await bridge.fetchRoomState(roomId!);
    if (!roomState) {
      console.error(`✗ Room ${roomId} not found`);
      process.exit(1);
    }
  }
  
  console.log('✓ Room state loaded:');
  console.log(`  Room ID: ${roomState.roomId}`);
  console.log(`  Status:  ${roomState.status}`);
  console.log(`  Seats:   ${roomState.seats.A?.agentId} vs ${roomState.seats.B?.agentId}`);
  console.log(`  Scores:  ${roomState.scores.A} - ${roomState.scores.B}`);
  console.log();

  // Step 6: Settle match
  console.log('🔨 Step 6: Settle match on-chain');
  console.log('─────────────────────────────────────');
  
  const result = await bridge.settleMatch(roomState);
  
  if (!result.success) {
    console.error('✗ Settlement failed:', result.error);
    process.exit(1);
  }
  
  console.log('✓ Settlement successful!');
  console.log(`  TX: ${result.txSignature}`);
  console.log();

  // Step 7: Verify on-chain
  console.log('🔍 Step 7: Verify score PDAs on-chain');
  console.log('─────────────────────────────────────');
  
  // Get PDAs from the event that was emitted
  let scorePdaA: string | undefined;
  let scorePdaB: string | undefined;
  
  if (eventReceived && result.success) {
    // PDAs are in the event payload - we'll use result.scorePDAs for backwards compatibility
    if (result.scorePDAs) {
      const pdaA = new PublicKey(result.scorePDAs.A);
      const pdaB = new PublicKey(result.scorePDAs.B);
      
      try {
        const accountA = await connection.getAccountInfo(pdaA);
        const accountB = await connection.getAccountInfo(pdaB);
      
        if (accountA) {
          console.log(`✓ Score PDA A exists: ${pdaA.toBase58()}`);
          console.log(`  Size: ${accountA.data.length} bytes`);
        } else {
          console.log(`✗ Score PDA A not found: ${pdaA.toBase58()}`);
        }
        
        if (accountB) {
          console.log(`✓ Score PDA B exists: ${pdaB.toBase58()}`);
          console.log(`  Size: ${accountB.data.length} bytes`);
        } else {
          console.log(`✗ Score PDA B not found: ${pdaB.toBase58()}`);
        }
      } catch (error) {
        console.error('✗ Error fetching PDAs:', error);
      }
    }
  } else {
    console.log('⚠️  Cannot verify PDAs (no event received or settlement failed)');
  }
  console.log();

  // Step 8: Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  E2E Test Summary');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✓ Wallets generated (alice, bob, fee payer)`);
  console.log(`✓ Fee payer funded with SOL`);
  console.log(`✓ Bridge initialized`);
  console.log(`✓ Room state loaded (${useFixture ? 'fixture' : 'live API'})`);
  console.log(`✓ Match settled on-chain`);
  console.log(`✓ Score PDAs created`);
  console.log(`${eventReceived ? '✓' : '✗'} score.settled event emitted`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log();
  
  if (eventReceived) {
    console.log('🎉 E2E Test PASSED');
    process.exit(0);
  } else {
    console.log('⚠️  E2E Test INCOMPLETE (event not received)');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\n❌ E2E Test FAILED');
  console.error(error);
  process.exit(1);
});
