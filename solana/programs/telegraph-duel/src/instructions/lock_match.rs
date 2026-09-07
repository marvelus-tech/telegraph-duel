use anchor_lang::prelude::*;
use crate::state::{MatchAccount, MatchState};
use crate::errors::TelegraphDuelError;

#[derive(Accounts)]
pub struct LockMatch<'info> {
    #[account(
        mut,
        constraint = match_account.player2.is_some() @ TelegraphDuelError::MatchFull,
        constraint = match_account.state == MatchState::WaitingForPlayer @ TelegraphDuelError::MatchLocked
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<LockMatch>) -> Result<()> {
    let match_account = &mut ctx.accounts.match_account;
    let clock = Clock::get()?;
    
    require!(
        ctx.accounts.authority.key() == match_account.player1 ||
        Some(ctx.accounts.authority.key()) == match_account.player2,
        TelegraphDuelError::Unauthorized
    );
    
    match_account.state = MatchState::Locked;
    match_account.locked_at = Some(clock.unix_timestamp);
    
    msg!("Match locked at {}", clock.unix_timestamp);
    
    Ok(())
}
