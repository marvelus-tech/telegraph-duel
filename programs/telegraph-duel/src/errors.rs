use anchor_lang::prelude::*;

#[error_code]
pub enum TelegraphDuelError {
    #[msg("Match is already full")]
    MatchFull,
    
    #[msg("Match is already locked")]
    MatchLocked,
    
    #[msg("Match is not locked yet")]
    MatchNotLocked,
    
    #[msg("Match is already settled")]
    MatchAlreadySettled,
    
    #[msg("Session key has expired")]
    SessionExpired,
    
    #[msg("Invalid session signature")]
    InvalidSessionSignature,
    
    #[msg("Player not in match")]
    PlayerNotInMatch,
    
    #[msg("Unauthorized")]
    Unauthorized,
}
