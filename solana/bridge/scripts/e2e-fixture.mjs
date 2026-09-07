#!/usr/bin/env node
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const PROGRAM_ID = new PublicKey("HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM");
const RPC = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const __dirname = dirname(fileURLToPath(import.meta.url));

function ixDisc(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}
function u64le(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}
function optPubkey(pk) {
  if (!pk) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pk.toBuffer()]);
}
function optI64(n) {
  if (n == null) return Buffer.from([0]);
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return Buffer.concat([Buffer.from([1]), b]);
}
function matchPda(matchId) {
  return PublicKey.findProgramAddressSync([Buffer.from("match"), matchId], PROGRAM_ID);
}
function scorePda(wallet) {
  return PublicKey.findProgramAddressSync([Buffer.from("score"), wallet.toBuffer()], PROGRAM_ID);
}
function generateMatchId(seed) {
  return createHash("sha256").update(seed).digest();
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
function decodeMatch(data) {
  let o = 8;
  const matchId = data.subarray(o, o + 32); o += 32;
  const player1 = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const hasP2 = data[o]; o += 1;
  let player2 = null;
  if (hasP2) { player2 = new PublicKey(data.subarray(o, o + 32)); o += 32; }
  const hasS1 = data[o]; o += 1; if (hasS1) o += 32;
  const hasS2 = data[o]; o += 1; if (hasS2) o += 32;
  const hasExp = data[o]; o += 1; if (hasExp) o += 8;
  const stateByte = data[o]; o += 1;
  const states = ["WaitingForPlayer", "Locked", "Settled"];
  const createdAt = Number(data.readBigInt64LE(o)); o += 8;
  const hasLocked = data[o]; o += 1;
  let lockedAt = null; if (hasLocked) { lockedAt = Number(data.readBigInt64LE(o)); o += 8; }
  const hasSettled = data[o]; o += 1;
  let settledAt = null; if (hasSettled) { settledAt = Number(data.readBigInt64LE(o)); o += 8; }
  return {
    matchId: matchId.toString("hex"),
    player1: player1.toBase58(),
    player2: player2 ? player2.toBase58() : null,
    state: states[stateByte] || String(stateByte),
    createdAt, lockedAt, settledAt,
  };
}
async function airdrop(connection, pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function main() {
  const fixturePath = process.argv[2] || join(__dirname, "../fixtures/completed-room.json");
  const room = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (room.status !== "completed") throw new Error("fixture not completed");
  if (!room.seats?.A?.agentId || !room.seats?.B?.agentId) throw new Error("missing seats");

  const agentA = room.seats.A.agentId;
  const agentB = room.seats.B.agentId;
  const scoreA = room.scores.A;
  const scoreB = room.scores.B;

  const connection = new Connection(RPC, "confirmed");
  const walletA = Keypair.generate();
  const walletB = Keypair.generate();

  const matchId = generateMatchId(room.roomId);
  const [matchPDA] = matchPda(matchId);
  const [scorePdaA] = scorePda(walletA.publicKey);
  const [scorePdaB] = scorePda(walletB.publicKey);

  console.log("E2E fixture: completed room -> settleMatch -> score PDA");
  console.log("fixture", fixturePath);
  console.log("roomId", room.roomId);
  console.log("agents", agentA, agentB);
  console.log("scores", scoreA, scoreB);
  console.log("PROGRAM_ID", PROGRAM_ID.toBase58());
  console.log("walletA", walletA.publicKey.toBase58());
  console.log("walletB", walletB.publicKey.toBase58());
  console.log("matchId", matchId.toString("hex"));
  console.log("matchPDA", matchPDA.toBase58());
  console.log("scorePDA_A", scorePdaA.toBase58());
  console.log("scorePDA_B", scorePdaB.toBase58());

  await airdrop(connection, walletA.publicKey);
  await airdrop(connection, walletB.publicKey);

  {
    const data = Buffer.concat([ixDisc("create_match"), matchId, optPubkey(null), optI64(null)]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    console.log("create_match", await sendAndConfirmTransaction(connection, new Transaction().add(ix), [walletA]));
  }
  {
    const data = Buffer.concat([ixDisc("join_match"), optPubkey(null), optI64(null)]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: walletB.publicKey, isSigner: true, isWritable: true },
      ],
      data,
    });
    console.log("join_match", await sendAndConfirmTransaction(connection, new Transaction().add(ix), [walletB]));
  }
  {
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: walletA.publicKey, isSigner: true, isWritable: false },
      ],
      data: ixDisc("lock_match"),
    });
    console.log("lock_match", await sendAndConfirmTransaction(connection, new Transaction().add(ix), [walletA]));
  }

  let settleSig;
  {
    const data = Buffer.concat([ixDisc("settle_match"), u64le(scoreA), u64le(scoreB)]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: matchPDA, isSigner: false, isWritable: true },
        { pubkey: scorePdaA, isSigner: false, isWritable: true },
        { pubkey: walletB.publicKey, isSigner: false, isWritable: false },
        { pubkey: scorePdaB, isSigner: false, isWritable: true },
        { pubkey: walletA.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    settleSig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [walletA]);
    console.log("settle_match", settleSig);
  }

  const matchInfo = await connection.getAccountInfo(matchPDA);
  const s1 = await connection.getAccountInfo(scorePdaA);
  const s2 = await connection.getAccountInfo(scorePdaB);
  if (!matchInfo || !s1 || !s2) throw new Error("missing on-chain accounts after settle");

  const matchDecoded = decodeMatch(matchInfo.data);
  const scoreADecoded = decodeScore(s1.data);
  const scoreBDecoded = decodeScore(s2.data);
  console.log("MATCH_ACCOUNT", JSON.stringify(matchDecoded));
  console.log("SCORE_A", JSON.stringify(scoreADecoded));
  console.log("SCORE_B", JSON.stringify(scoreBDecoded));

  if (matchDecoded.state !== "Settled") throw new Error("match not Settled");
  if (scoreADecoded.totalScore !== scoreA || scoreBDecoded.totalScore !== scoreB) {
    throw new Error("score PDA totals mismatch fixture");
  }

  const winnerSeat = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : null;
  const winnerAgentId = winnerSeat === "A" ? agentA : winnerSeat === "B" ? agentB : null;
  const event = {
    type: "score.settled",
    roomId: room.roomId,
    matchId: room.roomId,
    winnerAgentId,
    winnerSeat,
    finalScoresA: scoreA,
    finalScoresB: scoreB,
    agentIdA: agentA,
    agentIdB: agentB,
    walletA: walletA.publicKey.toBase58(),
    walletB: walletB.publicKey.toBase58(),
    scorePdaA: scorePdaA.toBase58(),
    scorePdaB: scorePdaB.toBase58(),
    txSig: settleSig,
    lastClashReason: room.lastClash && room.lastClash.reason,
    timestamp: Date.now(),
  };
  console.log("score.settled", JSON.stringify(event, null, 2));
  const required = ["roomId","matchId","winnerAgentId","winnerSeat","finalScoresA","finalScoresB","agentIdA","agentIdB","walletA","walletB","scorePdaA","scorePdaB","txSig"];
  for (const k of required) {
    if (event[k] === undefined || event[k] === null) throw new Error("flat score.settled missing " + k);
  }
  if (Object.prototype.hasOwnProperty.call(event, "data")) throw new Error("score.settled must be flat");
  console.log("PASS fixture E2E: score PDAs written and flat score.settled logged");

}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
