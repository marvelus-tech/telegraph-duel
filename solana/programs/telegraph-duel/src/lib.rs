use anchor_lang::prelude::*;

declare_id!("Du3LCxxx1111111111111111111111111111111111");

pub mod instructions;
pub mod state;
pub mod errors;

use instructions::*;

#[program]
pub mod telegraph_duel {
    use super::*;

    /// Create a new match with optional session key
    pub fn create_match(
        ctx: Context<CreateMatch>,
        match_id: [u8; 32],
        session_pubkey: Option<Pubkey>,
        session_expiry: Option<i64>,
    ) -> Result<()> {
        instructions::create_match::handler(ctx, match_id, session_pubkey, session_expiry)
    }

    /// Join an existing match
    pub fn join_match(
        ctx: Context<JoinMatch>,
        session_pubkey: Option<Pubkey>,
        session_expiry: Option<i64>,
    ) -> Result<()> {
        instructions::join_match::handler(ctx, session_pubkey, session_expiry)
    }

    /// Lock the match (no more joins, game starts)
    pub fn lock_match(ctx: Context<LockMatch>) -> Result<()> {
        instructions::lock_match::handler(ctx)
    }

    /// Settle match results and update score PDAs
    pub fn settle_match(
        ctx: Context<SettleMatch>,
        player1_score: u64,
        player2_score: u64,
    ) -> Result<()> {
        instructions::settle_match::handler(ctx, player1_score, player2_score)
    }

    /// Verify a session signature (helper for off-chain intent validation)
    pub fn verify_session_signature(
        ctx: Context<VerifySessionSignature>,
        message: Vec<u8>,
        signature: [u8; 64],
    ) -> Result<()> {
        instructions::verify_session_signature::handler(ctx, message, signature)
    }
}
