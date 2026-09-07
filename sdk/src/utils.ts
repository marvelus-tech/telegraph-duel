import { Keypair, PublicKey } from '@solana/web3.js';
import { randomBytes, createHash } from 'crypto';

/**
 * Generate a random match ID (32 bytes)
 */
export function generateMatchId(): Buffer {
  return Buffer.from(randomBytes(32));
}

/**
 * Generate a deterministic match ID from a string seed
 */
export function generateMatchIdFromSeed(seed: string): Buffer {
  const hash = createHash('sha256').update(seed).digest();
  return Buffer.from(hash);
}

/**
 * Parse match ID from hex string
 */
export function parseMatchId(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

/**
 * Format match ID to hex string
 */
export function formatMatchId(matchId: Buffer): string {
  return matchId.toString('hex');
}

/**
 * Load keypair from secret key
 */
export function loadKeypair(secretKey: Uint8Array): Keypair {
  return Keypair.fromSecretKey(secretKey);
}

/**
 * Save keypair to JSON format (compatible with Solana CLI)
 */
export function serializeKeypair(keypair: Keypair): number[] {
  return Array.from(keypair.secretKey);
}

/**
 * Load keypair from JSON format
 */
export function deserializeKeypair(json: number[]): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(json));
}

/**
 * Validate session key expiry
 */
export function isSessionExpired(expiryTimestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now >= expiryTimestamp;
}

/**
 * Format Unix timestamp to readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

/**
 * Shorten a public key for display
 */
export function shortenPubkey(pubkey: PublicKey | string, chars: number = 4): string {
  const str = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
  return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}
