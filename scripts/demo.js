import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  TelegraphDuelClient,
  generateMatchId,
  formatMatchId,
  shortenPubkey,
} from '../sdk/dist/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Demo script showing the complete Telegraph Duel flow:
 * 1. Create two keypairs (player1, player2)
 * 2. Create a match with session keys
 * 3. Player2 joins
 * 4. Lock the match
 * 5. Settle scores
 * 6. Print final PDAs
 */
async function main() {
  console.log('🎮 Telegraph Duel Demo\n');

  // Connect to local validator (or devnet)
  const endpoint = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
  const connection = new Connection(endpoint, 'confirmed');

  console.log(`📡 Connected to: ${endpoint}\n`);

  // Initialize client
  const client = new TelegraphDuelClient(connection);

  // Set up event listeners
  setupEventListeners(client);

  // Load or generate keypairs
  const player1 = await loadOrCreateKeypair('player1');
  const player2 = await loadOrCreateKeypair('player2');

  console.log(`👤 Player 1: ${shortenPubkey(player1.publicKey)}`);
  console.log(`👤 Player 2: ${shortenPubkey(player2.publicKey)}\n`);

  // Airdrop SOL if on localnet/devnet
  await ensureFunding(connection, player1.publicKey);
  await ensureFunding(connection, player2.publicKey);

  // Generate match ID
  const matchId = generateMatchId();
  const matchIdHex = formatMatchId(matchId);
  console.log(`🎯 Match ID: ${matchIdHex.slice(0, 16)}...\n`);

  // Step 1: Create session keys (spend-guard pattern)
  console.log('🔑 Creating session keys...');
  const player1Session = client.createSessionKey(3600); // 1 hour
  const player2Session = client.createSessionKey(3600);
  console.log(`   Player 1 session: ${shortenPubkey(player1Session.publicKey)}`);
  console.log(`   Player 2 session: ${shortenPubkey(player2Session.publicKey)}`);
  console.log(`   Expiry: ${new Date(player1Session.expiry * 1000).toISOString()}\n`);

  // Step 2: Create match
  console.log('📝 Creating match...');
  const createSig = await client.createMatch(player1, {
    matchId,
    sessionPubkey: player1Session.publicKey,
    sessionExpiry: player1Session.expiry,
  });
  console.log(`   ✅ Created: ${createSig.slice(0, 16)}...\n`);

  await sleep(1000);

  // Step 3: Join match
  console.log('🤝 Player 2 joining match...');
  const joinSig = await client.joinMatch(player2, {
    matchId,
    sessionPubkey: player2Session.publicKey,
    sessionExpiry: player2Session.expiry,
  });
  console.log(`   ✅ Joined: ${joinSig.slice(0, 16)}...\n`);

  await sleep(1000);

  // Step 4: Lock match
  console.log('🔒 Locking match...');
  const lockSig = await client.lockMatch(player1, matchId);
  console.log(`   ✅ Locked: ${lockSig.slice(0, 16)}...\n`);

  await sleep(1000);

  // Step 5: Simulate game (off-chain intents would happen here)
  console.log('⚔️  Simulating game...');
  console.log('   (Off-chain intents: tick 1, tick 2, tick 3...)');
  console.log('   Player 1 score: 100');
  console.log('   Player 2 score: 85\n');

  await sleep(2000);

  // Step 6: Settle match
  console.log('📊 Settling match...');
  const settleSig = await client.settleMatch(player1, {
    matchId,
    player1Score: 100,
    player2Score: 85,
  });
  console.log(`   ✅ Settled: ${settleSig.slice(0, 16)}...\n`);

  await sleep(1000);

  // Step 7: Fetch and display PDAs
  console.log('📖 Final state:\n');

  const matchAccount = await client.getMatchAccount(matchId);
  if (matchAccount) {
    const [matchPDA] = client.getMatchPDA(matchId);
    console.log(`   Match PDA: ${matchPDA.toBase58()}`);
    console.log(`   State: ${matchAccount.state}`);
    console.log(`   Created: ${new Date(matchAccount.createdAt * 1000).toISOString()}`);
    if (matchAccount.settledAt) {
      console.log(`   Settled: ${new Date(matchAccount.settledAt * 1000).toISOString()}`);
    }
    console.log();
  }

  const player1Score = await client.getPlayerScore(player1.publicKey);
  if (player1Score) {
    const [p1ScorePDA] = client.getPlayerScorePDA(player1.publicKey);
    console.log(`   Player 1 Score PDA: ${p1ScorePDA.toBase58()}`);
    console.log(`   Wins: ${player1Score.wins} | Losses: ${player1Score.losses} | Draws: ${player1Score.draws}`);
    console.log(`   Total Score: ${player1Score.totalScore} | Matches: ${player1Score.matchesPlayed}`);
    console.log();
  }

  const player2Score = await client.getPlayerScore(player2.publicKey);
  if (player2Score) {
    const [p2ScorePDA] = client.getPlayerScorePDA(player2.publicKey);
    console.log(`   Player 2 Score PDA: ${p2ScorePDA.toBase58()}`);
    console.log(`   Wins: ${player2Score.wins} | Losses: ${player2Score.losses} | Draws: ${player2Score.draws}`);
    console.log(`   Total Score: ${player2Score.totalScore} | Matches: ${player2Score.matchesPlayed}`);
    console.log();
  }

  console.log('✅ Demo complete!\n');
}

function setupEventListeners(client) {
  client.eventBus.on('*', (event) => {
    console.log(`   🔔 Event: ${event.eventType}`);
  });
}

async function loadOrCreateKeypair(name) {
  const keyPath = path.join('.keys', `${name}.json`);

  if (fs.existsSync(keyPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const keypair = Keypair.generate();
  fs.mkdirSync('.keys', { recursive: true });
  fs.writeFileSync(keyPath, JSON.stringify(Array.from(keypair.secretKey)));

  return keypair;
}

async function ensureFunding(connection, publicKey) {
  const balance = await connection.getBalance(publicKey);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    try {
      console.log(`   💰 Requesting airdrop for ${shortenPubkey(publicKey)}...`);
      const signature = await connection.requestAirdrop(
        publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(signature);
      console.log(`   ✅ Airdrop confirmed\n`);
    } catch (error) {
      console.log(`   ⚠️  Airdrop failed (might be on mainnet): ${error.message}\n`);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
