import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import type { CreateMatchParams, JoinMatchParams, SettleMatchParams, MatchAccount, PlayerScore, SessionKeyPair } from './types.js';
/**
 * Solana client for Telegraph Duel on-chain settlement
 * Aligns with game events from EVENTBUS.md
 */
export declare class TelegraphDuelClient {
    readonly connection: Connection;
    readonly programId: PublicKey;
    constructor(connection: Connection, programId?: PublicKey);
    /**
     * Derive match PDA from match ID
     */
    getMatchPDA(matchId: Buffer): [PublicKey, number];
    /**
     * Derive player score PDA
     */
    getPlayerScorePDA(playerPubkey: PublicKey): [PublicKey, number];
    /**
     * Create a new session keypair with expiry
     * Spend-guard pattern: this key can only be used for the specific match
     */
    createSessionKey(expirySeconds?: number): SessionKeyPair;
    /**
     * Create a new match
     * Triggered by match:start event
     */
    createMatch(player1: Keypair, params: CreateMatchParams): Promise<string>;
    /**
     * Join an existing match
     */
    joinMatch(player2: Keypair, params: JoinMatchParams): Promise<string>;
    /**
     * Lock the match (start game)
     * Can be triggered automatically when game starts
     */
    lockMatch(authority: Keypair, matchId: Buffer): Promise<string>;
    /**
     * Settle match and update score PDAs
     * Triggered by match:end event
     */
    settleMatch(authority: Keypair, params: SettleMatchParams): Promise<string>;
    /**
     * Fetch match account data
     */
    getMatchAccount(matchId: Buffer): Promise<MatchAccount | null>;
    /**
     * Fetch player score account data
     */
    getPlayerScore(playerPubkey: PublicKey): Promise<PlayerScore | null>;
    private buildCreateMatchInstruction;
    private buildJoinMatchInstruction;
    private buildLockMatchInstruction;
    private buildSettleMatchInstruction;
    private encodeCreateMatchData;
    private encodeJoinMatchData;
    private encodeSettleMatchData;
    private deserializeMatchAccount;
    private deserializePlayerScore;
}
