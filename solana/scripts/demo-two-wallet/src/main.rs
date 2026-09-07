use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};
use std::str::FromStr;
use std::thread;
use std::time::Duration;

const PROGRAM_ID: &str = "HLnw6FpGrfM7RD37gEMisMMA473GRtQ6zECMkdPqcbmM";
const RPC: &str = "http://127.0.0.1:8899";

fn ix_disc(name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", name));
    let hash = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&hash[..8]);
    out
}

fn match_pda(program: &Pubkey, match_id: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"match", match_id], program)
}

fn score_pda(program: &Pubkey, wallet: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"score", wallet.as_ref()], program)
}

fn gen_match_id(seed: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    let hash = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&hash);
    out
}

fn airdrop(client: &RpcClient, pk: &Pubkey, lamports: u64) {
    let sig = client.request_airdrop(pk, lamports).expect("airdrop");
    for _ in 0..30 {
        if client.confirm_transaction(&sig).unwrap_or(false) {
            return;
        }
        thread::sleep(Duration::from_millis(400));
    }
    panic!("airdrop not confirmed: {}", sig);
}

fn send_ix(client: &RpcClient, payer: &Keypair, ix: Instruction) -> String {
    let bh = client.get_latest_blockhash().expect("blockhash");
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], bh);
    let sig = client
        .send_and_confirm_transaction(&tx)
        .expect("send_and_confirm");
    sig.to_string()
}

fn read_u64_le(data: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(data[o..o + 8].try_into().unwrap())
}

fn read_i64_le(data: &[u8], o: usize) -> i64 {
    i64::from_le_bytes(data[o..o + 8].try_into().unwrap())
}

fn decode_match(data: &[u8]) {
    let mut o = 8usize;
    let match_id = &data[o..o + 32];
    o += 32;
    let player1 = Pubkey::new_from_array(data[o..o + 32].try_into().unwrap());
    o += 32;
    let has_p2 = data[o];
    o += 1;
    let player2 = if has_p2 == 1 {
        let pk = Pubkey::new_from_array(data[o..o + 32].try_into().unwrap());
        o += 32;
        Some(pk)
    } else {
        None
    };
    let has_s1 = data[o];
    o += 1;
    if has_s1 == 1 {
        o += 32;
    }
    let has_s2 = data[o];
    o += 1;
    if has_s2 == 1 {
        o += 32;
    }
    let has_exp = data[o];
    o += 1;
    if has_exp == 1 {
        o += 8;
    }
    let state = data[o];
    o += 1;
    let created_at = read_i64_le(data, o);
    o += 8;
    let has_locked = data[o];
    o += 1;
    let locked_at = if has_locked == 1 {
        let v = read_i64_le(data, o);
        o += 8;
        Some(v)
    } else {
        None
    };
    let has_settled = data[o];
    o += 1;
    let settled_at = if has_settled == 1 {
        let v = read_i64_le(data, o);
        o += 8;
        Some(v)
    } else {
        None
    };
    let bump = data[o];
    let states = ["WaitingForPlayer", "Locked", "Settled"];
    println!("MATCH_ACCOUNT {{");
    println!("  matchId: {}", hex::encode(match_id));
    println!("  player1: {}", player1);
    println!(
        "  player2: {}",
        player2.map(|p| p.to_string()).unwrap_or_else(|| "null".into())
    );
    println!("  state: {}", states.get(state as usize).unwrap_or(&"unknown"));
    println!("  createdAt: {}", created_at);
    println!("  lockedAt: {:?}", locked_at);
    println!("  settledAt: {:?}", settled_at);
    println!("  bump: {}", bump);
    println!("}}");
}

fn decode_score(label: &str, data: &[u8]) {
    let mut o = 8usize;
    let player = Pubkey::new_from_array(data[o..o + 32].try_into().unwrap());
    o += 32;
    let wins = read_u64_le(data, o);
    o += 8;
    let losses = read_u64_le(data, o);
    o += 8;
    let draws = read_u64_le(data, o);
    o += 8;
    let total_score = read_u64_le(data, o);
    o += 8;
    let matches_played = read_u64_le(data, o);
    o += 8;
    let bump = data[o];
    println!("{} {{", label);
    println!("  player: {}", player);
    println!("  wins: {}", wins);
    println!("  losses: {}", losses);
    println!("  draws: {}", draws);
    println!("  totalScore: {}", total_score);
    println!("  matchesPlayed: {}", matches_played);
    println!("  bump: {}", bump);
    println!("}}");
}

fn main() {
    let program = Pubkey::from_str(PROGRAM_ID).unwrap();
    let client = RpcClient::new_with_commitment(RPC.to_string(), CommitmentConfig::confirmed());

    let player1 = Keypair::new();
    let player2 = Keypair::new();
    assert_ne!(player1.pubkey(), player2.pubkey());

    let seed = format!("demo-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis());
    let match_id = gen_match_id(&seed);
    let (match_pda, _) = match_pda(&program, &match_id);
    let (p1_score, _) = score_pda(&program, &player1.pubkey());
    let (p2_score, _) = score_pda(&program, &player2.pubkey());

    println!("PROGRAM_ID {}", program);
    println!("player1 {}", player1.pubkey());
    println!("player2 {}", player2.pubkey());
    println!("matchId {}", hex::encode(match_id));
    println!("matchPDA {}", match_pda);
    println!("p1ScorePDA {}", p1_score);
    println!("p2ScorePDA {}", p2_score);

    println!("airdrop...");
    airdrop(&client, &player1.pubkey(), 2_000_000_000);
    airdrop(&client, &player2.pubkey(), 2_000_000_000);

    // create_match: match_id + Option::None + Option::None
    {
        let mut data = Vec::new();
        data.extend_from_slice(&ix_disc("create_match"));
        data.extend_from_slice(&match_id);
        data.push(0); // None session
        data.push(0); // None expiry
        let ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(match_pda, false),
                AccountMeta::new(player1.pubkey(), true),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data,
        };
        let sig = send_ix(&client, &player1, ix);
        println!("create_match {}", sig);
    }

    // join_match
    {
        let mut data = Vec::new();
        data.extend_from_slice(&ix_disc("join_match"));
        data.push(0);
        data.push(0);
        let ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(match_pda, false),
                AccountMeta::new(player2.pubkey(), true),
            ],
            data,
        };
        let sig = send_ix(&client, &player2, ix);
        println!("join_match {}", sig);
    }

    // lock_match
    {
        let mut data = Vec::new();
        data.extend_from_slice(&ix_disc("lock_match"));
        let ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(match_pda, false),
                AccountMeta::new_readonly(player1.pubkey(), true),
            ],
            data,
        };
        let sig = send_ix(&client, &player1, ix);
        println!("lock_match {}", sig);
    }

    // settle_match 3-2 (local patch includes player2 account)
    {
        let mut data = Vec::new();
        data.extend_from_slice(&ix_disc("settle_match"));
        data.extend_from_slice(&3u64.to_le_bytes());
        data.extend_from_slice(&2u64.to_le_bytes());
        let ix = Instruction {
            program_id: program,
            accounts: vec![
                AccountMeta::new(match_pda, false),
                AccountMeta::new(p1_score, false),
                AccountMeta::new_readonly(player2.pubkey(), false),
                AccountMeta::new(p2_score, false),
                AccountMeta::new(player1.pubkey(), true),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data,
        };
        let sig = send_ix(&client, &player1, ix);
        println!("settle_match {}", sig);
    }

    let match_acc = client.get_account_data(&match_pda).expect("match account");
    let s1 = client.get_account_data(&p1_score).expect("p1 score");
    let s2 = client.get_account_data(&p2_score).expect("p2 score");
    decode_match(&match_acc);
    decode_score("PLAYER1_SCORE", &s1);
    decode_score("PLAYER2_SCORE", &s2);
    println!("SUCCESS two distinct keypairs settled on localnet");
}
