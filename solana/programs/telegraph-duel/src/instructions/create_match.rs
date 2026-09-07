use anchor_lang::prelude::*;
use crate::state::{MatchAccount, MatchState};

#[derive(Accounts)]
#[instruction(match_id: [u8; 32])]
pub struct CreateMatch<'info> {
    #[account(
        init,
        payer = player1,
        space = MatchAccount::LEN,
        seeds = [b"match", match_id.as_ref()],
        bump
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(mut)]
    pub player1: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateMatch>,
    match_id: [u8; 32],
    session_pubkey: Option<Pubkey>,
    session_expiry: Option<i64>,
) -> Result<()> {
    let match_account = &mut ctx.accounts.match_account;
    let clock = Clock::get()?;
    
    match_account.match_id = match_id;
    match_account.player1 = ctx.accounts.player1.key();
    match_account.player2 = None;
    match_account.player1_session = session_pubkey;
    match_account.player2_session = None;
    match_account.session_expiry = session_expiry;
    match_account.state = MatchState::WaitingForPlayer;
    match_account.created_at = clock.unix_timestamp;
    match_account.locked_at = None;
    match_account.settled_at = None;
    match_account.bump = ctx.bumps.match_account;
    
    msg!("Match created: {:?}", match_id);
    msg!("Player1: {}", ctx.accounts.player1.key());
    if let Some(session) = session_pubkey {
        msg!("Player1 session: {}", session);
    }
    
    Ok(())
}
