import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BN, Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import type {
  CreateMatchParams,
  JoinMatchParams,
  SettleMatchParams,
  MatchAccount,
  PlayerScore,
  SessionKeyPair,
} from './types.js';
import { EventBus } from './eventbus.js';

const PROGRAM_ID = new PublicKey('Du3LCxxx1111111111111111111111111111111111');

export class TelegraphDuelClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly eventBus: EventBus;
  private provider?: AnchorProvider;
  private program?: Program;

  constructor(connection: Connection, programId: PublicKey = PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
    this.eventBus = new EventBus();
  }

  /**
   * Initialize the Anchor program (requires wallet)
   */
  initProgram(wallet: Keypair) {
    this.provider = new AnchorProvider(
      this.connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: async (tx) => {
          tx.partialSign(wallet);
          return tx;
        },
        signAllTransactions: async (txs) => {
          txs.forEach((tx) => tx.partialSign(wallet));
          return txs;
        },
      },
      { commitment: 'confirmed' }
    );
  }

  /**
   * Derive match PDA
   */
  getMatchPDA(matchId: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('match'), matchId],
      this.programId
    );
  }

  /**
   * Derive player score PDA
   */
  getPlayerScorePDA(playerPubkey: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('score'), playerPubkey.toBuffer()],
      this.programId
    );
  }

  /**
   * Create a new session keypair with expiry
   * Spend-guard pattern: this key can only be used for the specific match
   */
  createSessionKey(expirySeconds: number = 3600): SessionKeyPair {
    const keypair = Keypair.generate();
    const expiry = Math.floor(Date.now() / 1000) + expirySeconds;

    return {
      publicKey: keypair.publicKey,
      secretKey: keypair.secretKey,
      expiry,
    };
  }

  /**
   * Create a new match
   */
  async createMatch(
    player1: Keypair,
    params: CreateMatchParams
  ): Promise<string> {
    const [matchPDA] = this.getMatchPDA(params.matchId);

    const instruction = await this.buildCreateMatchInstruction(
      matchPDA,
      player1.publicKey,
      params
    );

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [player1],
      { commitment: 'confirmed' }
    );

    this.eventBus.emit('match.created', {
      matchId: params.matchId.toString('hex'),
      player1: player1.publicKey.toBase58(),
      matchPDA: matchPDA.toBase58(),
      signature,
    });

    return signature;
  }

  /**
   * Join an existing match
   */
  async joinMatch(
    player2: Keypair,
    params: JoinMatchParams
  ): Promise<string> {
    const [matchPDA] = this.getMatchPDA(params.matchId);

    const instruction = await this.buildJoinMatchInstruction(
      matchPDA,
      player2.publicKey,
      params
    );

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [player2],
      { commitment: 'confirmed' }
    );

    this.eventBus.emit('match.joined', {
      matchId: params.matchId.toString('hex'),
      player2: player2.publicKey.toBase58(),
      matchPDA: matchPDA.toBase58(),
      signature,
    });

    return signature;
  }

  /**
   * Lock the match (start game)
   */
  async lockMatch(authority: Keypair, matchId: Buffer): Promise<string> {
    const [matchPDA] = this.getMatchPDA(matchId);

    const instruction = await this.buildLockMatchInstruction(
      matchPDA,
      authority.publicKey
    );

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [authority],
      { commitment: 'confirmed' }
    );

    this.eventBus.emit('match.locked', {
      matchId: matchId.toString('hex'),
      matchPDA: matchPDA.toBase58(),
      signature,
    });

    return signature;
  }

  /**
   * Settle match and update score PDAs
   */
  async settleMatch(
    authority: Keypair,
    params: SettleMatchParams
  ): Promise<string> {
    const [matchPDA] = this.getMatchPDA(params.matchId);
    const matchAccount = await this.getMatchAccount(params.matchId);

    if (!matchAccount || !matchAccount.player2) {
      throw new Error('Match not found or player2 not joined');
    }

    const [player1ScorePDA] = this.getPlayerScorePDA(matchAccount.player1);
    const [player2ScorePDA] = this.getPlayerScorePDA(matchAccount.player2);

    const instruction = await this.buildSettleMatchInstruction(
      matchPDA,
      player1ScorePDA,
      player2ScorePDA,
      authority.publicKey,
      params.player1Score,
      params.player2Score
    );

    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [authority],
      { commitment: 'confirmed' }
    );

    this.eventBus.emit('score.settled', {
      matchId: params.matchId.toString('hex'),
      player1Score: params.player1Score,
      player2Score: params.player2Score,
      matchPDA: matchPDA.toBase58(),
      signature,
    });

    return signature;
  }

  /**
   * Fetch match account data
   */
  async getMatchAccount(matchId: Buffer): Promise<MatchAccount | null> {
    const [matchPDA] = this.getMatchPDA(matchId);

    try {
      const accountInfo = await this.connection.getAccountInfo(matchPDA);
      if (!accountInfo) return null;

      return this.deserializeMatchAccount(accountInfo.data);
    } catch (error) {
      console.error('Error fetching match account:', error);
      return null;
    }
  }

  /**
   * Fetch player score account data
   */
  async getPlayerScore(playerPubkey: PublicKey): Promise<PlayerScore | null> {
    const [scorePDA] = this.getPlayerScorePDA(playerPubkey);

    try {
      const accountInfo = await this.connection.getAccountInfo(scorePDA);
      if (!accountInfo) return null;

      return this.deserializePlayerScore(accountInfo.data);
    } catch (error) {
      console.error('Error fetching player score:', error);
      return null;
    }
  }

  // Private instruction builders

  private async buildCreateMatchInstruction(
    matchPDA: PublicKey,
    player1: PublicKey,
    params: CreateMatchParams
  ): Promise<TransactionInstruction> {
    // Simplified instruction building - in production, use generated Anchor types
    const keys = [
      { pubkey: matchPDA, isSigner: false, isWritable: true },
      { pubkey: player1, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const data = this.encodeCreateMatchData(params);

    return new TransactionInstruction({
      keys,
      programId: this.programId,
      data,
    });
  }

  private async buildJoinMatchInstruction(
    matchPDA: PublicKey,
    player2: PublicKey,
    params: JoinMatchParams
  ): Promise<TransactionInstruction> {
    const keys = [
      { pubkey: matchPDA, isSigner: false, isWritable: true },
      { pubkey: player2, isSigner: true, isWritable: true },
    ];

    const data = this.encodeJoinMatchData(params);

    return new TransactionInstruction({
      keys,
      programId: this.programId,
      data,
    });
  }

  private async buildLockMatchInstruction(
    matchPDA: PublicKey,
    authority: PublicKey
  ): Promise<TransactionInstruction> {
    const keys = [
      { pubkey: matchPDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ];

    const discriminator = Buffer.from([0x02]); // lock_match discriminator

    return new TransactionInstruction({
      keys,
      programId: this.programId,
      data: discriminator,
    });
  }

  private async buildSettleMatchInstruction(
    matchPDA: PublicKey,
    player1ScorePDA: PublicKey,
    player2ScorePDA: PublicKey,
    authority: PublicKey,
    player1Score: number,
    player2Score: number
  ): Promise<TransactionInstruction> {
    const keys = [
      { pubkey: matchPDA, isSigner: false, isWritable: true },
      { pubkey: player1ScorePDA, isSigner: false, isWritable: true },
      { pubkey: player2ScorePDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const data = this.encodeSettleMatchData(player1Score, player2Score);

    return new TransactionInstruction({
      keys,
      programId: this.programId,
      data,
    });
  }

  // Simplified encoding methods - in production, use Anchor IDL types
  private encodeCreateMatchData(params: CreateMatchParams): Buffer {
    const discriminator = Buffer.from([0x00]); // create_match discriminator
    return Buffer.concat([discriminator, params.matchId]);
  }

  private encodeJoinMatchData(params: JoinMatchParams): Buffer {
    const discriminator = Buffer.from([0x01]); // join_match discriminator
    return discriminator;
  }

  private encodeSettleMatchData(
    player1Score: number,
    player2Score: number
  ): Buffer {
    const discriminator = Buffer.from([0x03]); // settle_match discriminator
    const p1 = Buffer.alloc(8);
    p1.writeBigUInt64LE(BigInt(player1Score));
    const p2 = Buffer.alloc(8);
    p2.writeBigUInt64LE(BigInt(player2Score));
    return Buffer.concat([discriminator, p1, p2]);
  }

  // Simplified deserialization - in production, use Anchor IDL
  private deserializeMatchAccount(data: Buffer): MatchAccount {
    // Skip discriminator (8 bytes), parse rest
    let offset = 8;

    const matchId = data.subarray(offset, offset + 32);
    offset += 32;

    const player1 = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // This is simplified - actual deserialization needs proper Option handling
    return {
      matchId,
      player1,
      player2: null,
      player1Session: null,
      player2Session: null,
      sessionExpiry: null,
      state: 'WaitingForPlayer',
      createdAt: 0,
      lockedAt: null,
      settledAt: null,
      bump: 0,
    };
  }

  private deserializePlayerScore(data: Buffer): PlayerScore {
    // Simplified deserialization
    let offset = 8;
    const player = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    return {
      player,
      wins: 0,
      losses: 0,
      draws: 0,
      totalScore: 0,
      matchesPlayed: 0,
      bump: 0,
    };
  }
}
