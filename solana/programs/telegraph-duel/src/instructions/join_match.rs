use anchor_lang::prelude::*;
use crate::state::{MatchAccount, MatchState};
use crate::errors::TelegraphDuelError;

#[derive(Accounts)]
pub struct JoinMatch<'info> {
    #[account(
        mut,
        constraint = match_account.player2.is_none() @ TelegraphDuelError::MatchFull,
        constraint = match_account.state == MatchState::WaitingForPlayer @ TelegraphDuelError::MatchLocked
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub player2: Signer<'info>,
}

pub fn handler(
    ctx: Context<JoinMatch>,
    session_pubkey: Option<Pubkey>,
    session_expiry: Option<i64>,
) -> Result<()> {
    let match_account = &mut ctx.accounts.match_account;
    
    require!(
        ctx.accounts.player2.key() != match_account.player1,
        TelegraphDuelError::Unauthorized
    );
    
    match_account.player2 = Some(ctx.accounts.player2.key());
    match_account.player2_session = session_pubkey;
    
    if let Some(expiry) = session_expiry {
        match_account.session_expiry = Some(expiry);
    }
    
    msg!("Player2 joined match: {}", ctx.accounts.player2.key());
    if let Some(session) = session_pubkey {
        msg!("Player2 session: {}", session);
    }
    
    Ok(())
}
