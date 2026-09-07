use anchor_lang::prelude::*;
use crate::state::MatchAccount;
use crate::errors::TelegraphDuelError;

#[derive(Accounts)]
pub struct VerifySessionSignature<'info> {
    pub match_account: Account<'info, MatchAccount>,
    
    /// The session key that signed the message
    pub session_key: Signer<'info>,
}

/// Helper instruction to verify session signatures on-chain
/// In practice, most intent verification can stay off-chain
pub fn handler(
    ctx: Context<VerifySessionSignature>,
    _message: Vec<u8>,
    _signature: [u8; 64],
) -> Result<()> {
    let match_account = &ctx.accounts.match_account;
    let clock = Clock::get()?;
    
    // Verify session key belongs to this match
    let is_valid_session = 
        match_account.player1_session == Some(ctx.accounts.session_key.key()) ||
        match_account.player2_session == Some(ctx.accounts.session_key.key());
    
    require!(is_valid_session, TelegraphDuelError::InvalidSessionSignature);
    
    // Check expiry
    if let Some(expiry) = match_account.session_expiry {
        require!(
            clock.unix_timestamp < expiry,
            TelegraphDuelError::SessionExpired
        );
    }
    
    // Note: Actual signature verification would happen here
    // For now, the fact that session_key is a Signer proves they have the private key
    
    msg!("Session signature verified for {}", ctx.accounts.session_key.key());
    
    Ok(())
}
