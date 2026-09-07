import { Keypair } from '@solana/web3.js';
import { createHash } from 'crypto';
/**
 * Generate a deterministic match ID from a string seed
 * Used to create consistent match IDs from game events
 */
export function generateMatchId(seed) {
    const hash = createHash('sha256').update(seed).digest();
    return Buffer.from(hash);
}
/**
 * Parse match ID from hex string
 */
export function parseMatchId(hex) {
    return Buffer.from(hex, 'hex');
}
/**
 * Format match ID to hex string
 */
export function formatMatchId(matchId) {
    return matchId.toString('hex');
}
/**
 * Load keypair from secret key
 */
export function loadKeypair(secretKey) {
    return Keypair.fromSecretKey(secretKey);
}
/**
 * Save keypair to JSON format (compatible with Solana CLI)
 */
export function serializeKeypair(keypair) {
    return Array.from(keypair.secretKey);
}
/**
 * Load keypair from JSON format
 */
export function deserializeKeypair(json) {
    return Keypair.fromSecretKey(Uint8Array.from(json));
}
/**
 * Validate session key expiry
 */
export function isSessionExpired(expiryTimestamp) {
    const now = Math.floor(Date.now() / 1000);
    return now >= expiryTimestamp;
}
/**
 * Format Unix timestamp to readable date
 */
export function formatTimestamp(timestamp) {
    return new Date(timestamp * 1000).toISOString();
}
/**
 * Shorten a public key for display
 */
export function shortenPubkey(pubkey, chars = 4) {
    const str = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
    return `${str.slice(0, chars)}...${str.slice(-chars)}`;
}
