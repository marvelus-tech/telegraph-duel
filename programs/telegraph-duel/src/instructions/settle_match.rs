use anchor_lang::prelude::*;
use crate::state::{MatchAccount, MatchState, PlayerScore};
use crate::errors::TelegraphDuelError;

#[derive(Accounts)]
pub struct SettleMatch<'info> {
    #[account(
        mut,
        constraint = match_account.state == MatchState::Locked @ TelegraphDuelError::MatchNotLocked
    )]
    pub match_account: Account<'info, MatchAccount>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = PlayerScore::LEN,
        seeds = [b"score", match_account.player1.as_ref()],
        bump
    )]
    pub player1_score: Account<'info, PlayerScore>,
    
    #[account(
        init_if_needed,
        payer = authority,
        space = PlayerScore::LEN,
        seeds = [b"score", match_account.player2.unwrap().as_ref()],
        bump
    )]
    pub player2_score: Account<'info, PlayerScore>,
    
    /// Authority must be one of the players or session key
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SettleMatch>,
    player1_score: u64,
    player2_score: u64,
) -> Result<()> {
    let match_account = &mut ctx.accounts.match_account;
    let clock = Clock::get()?;
    
    // Verify authority (player or session key)
    let is_player1 = ctx.accounts.authority.key() == match_account.player1;
    let is_player2 = Some(ctx.accounts.authority.key()) == match_account.player2;
    let is_player1_session = match_account.player1_session
        .map(|s| s == ctx.accounts.authority.key())
        .unwrap_or(false);
    let is_player2_session = match_account.player2_session
        .map(|s| s == ctx.accounts.authority.key())
        .unwrap_or(false);
    
    require!(
        is_player1 || is_player2 || is_player1_session || is_player2_session,
        TelegraphDuelError::Unauthorized
    );
    
    // Check session expiry if using session key
    if is_player1_session || is_player2_session {
        if let Some(expiry) = match_account.session_expiry {
            require!(
                clock.unix_timestamp < expiry,
                TelegraphDuelError::SessionExpired
            );
        }
    }
    
    // Initialize player scores if needed
    let p1_score = &mut ctx.accounts.player1_score;
    if p1_score.matches_played == 0 {
        p1_score.player = match_account.player1;
        p1_score.bump = ctx.bumps.player1_score;
    }
    
    let p2_score = &mut ctx.accounts.player2_score;
    if p2_score.matches_played == 0 {
        p2_score.player = match_account.player2.unwrap();
        p2_score.bump = ctx.bumps.player2_score;
    }
    
    // Update scores
    p1_score.total_score += player1_score;
    p1_score.matches_played += 1;
    
    p2_score.total_score += player2_score;
    p2_score.matches_played += 1;
    
    // Determine winner
    if player1_score > player2_score {
        p1_score.wins += 1;
        p2_score.losses += 1;
        msg!("Player1 wins! {} - {}", player1_score, player2_score);
    } else if player2_score > player1_score {
        p2_score.wins += 1;
        p1_score.losses += 1;
        msg!("Player2 wins! {} - {}", player1_score, player2_score);
    } else {
        p1_score.draws += 1;
        p2_score.draws += 1;
        msg!("Draw! {} - {}", player1_score, player2_score);
    }
    
    // Mark match as settled
    match_account.state = MatchState::Settled;
    match_account.settled_at = Some(clock.unix_timestamp);
    
    msg!("Match settled at {}", clock.unix_timestamp);
    
    Ok(())
}
