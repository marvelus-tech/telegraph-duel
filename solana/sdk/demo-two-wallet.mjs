import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createHash } from 'crypto';

const PROGRAM_ID = new PublicKey('HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM');
const RPC = 'http://127.0.0.1:8899';

function ixDisc(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function i64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
}

function optPubkey(pk) {
  if (!pk) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
}

function optI64(n) {
  if (n == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), i64le(n)]);
}

function matchPda(matchId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('match'), matchId],
    PROGRAM_ID
  );
}

function scorePda(wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('score'), wallet.toBuffer()],
    PROGRAM_ID
  );
}

function generateMatchId(seed) {
  return createHash('sha256').update(seed).digest();
}

function decodeMatch(data) {
  let o = 8;
  const matchId = data.subarray(o, o + 32); o += 32;
  const player1 = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const hasP2 = data[o]; o += 1;
  let player2 = null;
  if (hasP2) { player2 = new PublicKey(data.subarray(o, o + 32)); o += 32; }
  const hasS1 = data[o]; o += 1;
  if (hasS1) o += 32;
  const hasS2 = data[o]; o += 1;
  if (hasS2) o += 32;
  const hasExp = data[o]; o += 1;
  if (hasExp) o += 8;
  const stateByte = data[o]; o += 1;
  const states = ['WaitingForPlayer', 'Locked', 'Settled'];
  const createdAt = Number(data.readBigInt64LE(o)); o += 8;
  const hasLocked = data[o]; o += 1;
  let lockedAt = null;
  if (hasLocked) { lockedAt = Number(data.readBigInt64LE(o)); o += 8; }
  const hasSettled = data[o]; o += 1;
  let settledAt = null;
  if (hasSettled) { settledAt = Number(data.readBigInt64LE(o)); o += 8; }
  const bump = data[o];
  return {
    matchId: matchId.toString('hex'),
    player1: player1.toBase58(),
    player2: player2 ? player2.toBase58() : null,
    state: states[stateByte] || String(stateByte),
    createdAt,
    lockedAt,
    settledAt,
    bump,
  };
}

function decodeScore(data) {
  let o = 8;
  const player = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const wins = Number(data.readBigUInt64LE(o)); o += 8;
  const losses = Number(data.readBigUInt64LE(o)); o += 8;
  const draws = Number(data.readBigUInt64LE(o)); o += 8;
  const totalScore = Number(data.readBigUInt64LE(o)); o += 8;
  const matchesPlayed = Number(data.readBigUInt64LE(o)); o += 8;
  const bump = data[o];
  return { player: player.toBase58(), wins, losses, draws, totalScore, matchesPlayed, bump };
}

async function airdrop(connection, pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  const seed = `demo-${Date.now()}`;
  const matchId = generateMatchId(seed);
  const [matchPDA] = matchPda(matchId);
  const [p1ScorePDA] = scorePda(player1.publicKey);
  const [p2ScorePDA] = scorePda(player2.publicKey);

  console.log('PROGRAM_ID', PROGRAM_ID.toBase58());
  console.log('player1', player1.publicKey.toBase58());
  console.log('player2', player2.publicKey.toBase58());
  console.log('matchId', matchId.toString('hex'));
  console.log('matchPDA', matchPDA.toBase58());
  console.log('p1ScorePDA', p1ScorePDA.toBase58());
  console.log('p2ScorePDA', p2ScorePDA.toBase58());

  if (player1.publicKey.equals(player2.publicKey)) {
    throw new Error('keypairs not distinct');
  }

  console.log('airdrop...');
  await airdrop(connection, player1.publicKey);
  await airdrop(connection, player2.publicKey);

  // create_match: match_id + OptionNone session + OptionNone expiry
  {
    const data = Buffer.concat([
      ixDisc('create_match'),
      matchId,
      optPubkey(null),
      optI64(null),
    ]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: player1.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [player1]);
    console.log('create_match', sig);
  }

  // join_match
  {
    const data = Buffer.concat([
      ixDisc('join_match'),
      optPubkey(null),
      optI64(null),
    ]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: player2.publicKey, isSigner: true, isWritable: true },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [player2]);
    console.log('join_match', sig);
  }

  // lock_match
  {
    const data = ixDisc('lock_match');
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: player1.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [player1]);
    console.log('lock_match', sig);
  }

  // settle_match 3-2 (accounts include player2 UncheckedAccount from local patch)
  {
    const data = Buffer.concat([
      ixDisc('settle_match'),
      u64le(3),
      u64le(2),
    ]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: p1ScorePDA, isSigner: false, isWritable: true },
        { pubkey: player2.publicKey, isSigner: false, isWritable: false },
        { pubkey: p2ScorePDA, isSigner: false, isWritable: true },
        { pubkey: player1.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [player1]);
    console.log('settle_match', sig);
  }

  const matchInfo = await connection.getAccountInfo(matchPDA);
  const s1 = await connection.getAccountInfo(p1ScorePDA);
  const s2 = await connection.getAccountInfo(p2ScorePDA);

  console.log('MATCH_ACCOUNT', JSON.stringify(decodeMatch(matchInfo.data), null, 2));
  console.log('PLAYER1_SCORE', JSON.stringify(decodeScore(s1.data), null, 2));
  console.log('PLAYER2_SCORE', JSON.stringify(decodeScore(s2.data), null, 2));
  console.log('SUCCESS two distinct keypairs settled on localnet');
}

main().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
