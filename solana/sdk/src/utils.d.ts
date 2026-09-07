import { Keypair, PublicKey } from '@solana/web3.js';
/**
 * Generate a deterministic match ID from a string seed
 * Used to create consistent match IDs from game events
 */
export declare function generateMatchId(seed: string): Buffer;
/**
 * Parse match ID from hex string
 */
export declare function parseMatchId(hex: string): Buffer;
/**
 * Format match ID to hex string
 */
export declare function formatMatchId(matchId: Buffer): string;
/**
 * Load keypair from secret key
 */
export declare function loadKeypair(secretKey: Uint8Array): Keypair;
/**
 * Save keypair to JSON format (compatible with Solana CLI)
 */
export declare function serializeKeypair(keypair: Keypair): number[];
/**
 * Load keypair from JSON format
 */
export declare function deserializeKeypair(json: number[]): Keypair;
/**
 * Validate session key expiry
 */
export declare function isSessionExpired(expiryTimestamp: number): boolean;
/**
 * Format Unix timestamp to readable date
 */
export declare function formatTimestamp(timestamp: number): string;
/**
 * Shorten a public key for display
 */
export declare function shortenPubkey(pubkey: PublicKey | string, chars?: number): string;
