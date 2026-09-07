use anchor_lang::prelude::*;

#[account]
pub struct MatchAccount {
    /// Unique identifier for this match
    pub match_id: [u8; 32],
    
    /// Player 1 wallet
    pub player1: Pubkey,
    
    /// Player 2 wallet (None until joined)
    pub player2: Option<Pubkey>,
    
    /// Player 1 session key (optional, for spend-guard pattern)
    pub player1_session: Option<Pubkey>,
    
    /// Player 2 session key (optional)
    pub player2_session: Option<Pubkey>,
    
    /// Session expiry timestamp (unix seconds)
    pub session_expiry: Option<i64>,
    
    /// Match state
    pub state: MatchState,
    
    /// Creation timestamp
    pub created_at: i64,
    
    /// Lock timestamp (when both players ready)
    pub locked_at: Option<i64>,
    
    /// Settlement timestamp
    pub settled_at: Option<i64>,
    
    /// Bump seed for PDA
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum MatchState {
    /// Waiting for player 2
    WaitingForPlayer,
    
    /// Both players joined, game active
    Locked,
    
    /// Match finished, scores settled
    Settled,
}

impl MatchAccount {
    pub const LEN: usize = 8 + // discriminator
        32 + // match_id
        32 + // player1
        1 + 32 + // player2 Option
        1 + 32 + // player1_session Option
        1 + 32 + // player2_session Option
        1 + 8 + // session_expiry Option
        1 + // state enum
        8 + // created_at
        1 + 8 + // locked_at Option
        1 + 8 + // settled_at Option
        1; // bump
}
