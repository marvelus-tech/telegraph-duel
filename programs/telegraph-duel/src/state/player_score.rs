use anchor_lang::prelude::*;

/// Player's cumulative score PDA (seeds: ["score", wallet])
#[account]
pub struct PlayerScore {
    /// Player wallet address
    pub player: Pubkey,
    
    /// Total wins
    pub wins: u64,
    
    /// Total losses
    pub losses: u64,
    
    /// Total draws
    pub draws: u64,
    
    /// Total score points accumulated
    pub total_score: u64,
    
    /// Number of matches played
    pub matches_played: u64,
    
    /// Bump seed
    pub bump: u8,
}

impl PlayerScore {
    pub const LEN: usize = 8 + // discriminator
        32 + // player
        8 + // wins
        8 + // losses
        8 + // draws
        8 + // total_score
        8 + // matches_played
        1; // bump
}
