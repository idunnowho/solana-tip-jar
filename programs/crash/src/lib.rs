use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, CreateAccount, Transfer};

declare_id!("GxMvwW87a6AvD22YUHQfV25kFB4MzS8KHerjpHtJYVcA");

pub const PHASE_IDLE: u8 = 0;
pub const PHASE_BETTING: u8 = 1;
pub const PHASE_RESOLVED: u8 = 2;

pub const MIN_BET_LAMPORTS: u64 = 10_000_000;
pub const MAX_BET_LAMPORTS: u64 = 1_000_000_000;
pub const MIN_CASHOUT_BPS: u32 = 10_100;
pub const MAX_CASHOUT_BPS: u32 = 500_000;
pub const ONE_X_BPS: u32 = 10_000;
pub const MAX_CRASH_BPS: u32 = 500_000;

#[program]
pub mod crash {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.round_id = 0;
        config.phase = PHASE_IDLE;
        config.bump = ctx.bumps.config;
        config.history = [0; 12];
        config.history_len = 0;

        let rent = Rent::get()?.minimum_balance(0);
        let bump = ctx.bumps.vault;
        let signer: &[&[u8]] = &[b"vault", &[bump]];
        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                CreateAccount {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
                &[signer],
            ),
            rent,
            0,
            &system_program::ID,
        )?;
        Ok(())
    }

    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(amount > 0, CrashError::BadAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn open_round(ctx: Context<OpenRound>, round_id: u64, betting_seconds: u16) -> Result<()> {
        require!(
            (5..=120).contains(&betting_seconds),
            CrashError::BadDuration
        );
        let config = &mut ctx.accounts.config;
        require!(config.phase != PHASE_BETTING, CrashError::RoundInProgress);
        require!(round_id == config.round_id + 1, CrashError::BadRound);

        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        round.id = round_id;
        round.opened_slot = clock.slot;
        round.reveal_slot = clock.slot.saturating_add(betting_seconds as u64);
        round.betting_ends_at = clock
            .unix_timestamp
            .saturating_add(betting_seconds as i64);
        round.phase = PHASE_BETTING;
        round.crash_bps = 0;
        round.total_wagered = 0;
        round.bump = ctx.bumps.round;

        config.round_id = round_id;
        config.phase = PHASE_BETTING;

        emit!(RoundOpened {
            round_id,
            betting_ends_at: round.betting_ends_at,
            reveal_slot: round.reveal_slot,
        });
        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, cashout_bps: u32) -> Result<()> {
        require!(
            (MIN_BET_LAMPORTS..=MAX_BET_LAMPORTS).contains(&amount),
            CrashError::BadAmount
        );
        require!(
            (MIN_CASHOUT_BPS..=MAX_CASHOUT_BPS).contains(&cashout_bps),
            CrashError::BadCashout
        );
        let clock = Clock::get()?;
        require!(
            ctx.accounts.config.phase == PHASE_BETTING,
            CrashError::NotBetting
        );
        require!(
            clock.unix_timestamp < ctx.accounts.round.betting_ends_at,
            CrashError::BettingClosed
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let round = &mut ctx.accounts.round;
        round.total_wagered = round
            .total_wagered
            .checked_add(amount)
            .ok_or(CrashError::Overflow)?;

        let bet = &mut ctx.accounts.bet;
        bet.player = ctx.accounts.player.key();
        bet.round_id = round.id;
        bet.amount = amount;
        bet.cashout_bps = cashout_bps;
        bet.claimed = false;
        bet.payout = 0;
        bet.bump = ctx.bumps.bet;

        emit!(BetPlaced {
            player: bet.player,
            round_id: bet.round_id,
            amount,
            cashout_bps,
        });
        Ok(())
    }

    pub fn launch(ctx: Context<Launch>) -> Result<()> {
        let clock = Clock::get()?;
        let round = &mut ctx.accounts.round;
        require!(
            ctx.accounts.config.phase == PHASE_BETTING && round.phase == PHASE_BETTING,
            CrashError::NotBetting
        );
        require!(round.id == ctx.accounts.config.round_id, CrashError::BadRound);
        require!(
            clock.unix_timestamp >= round.betting_ends_at,
            CrashError::BettingOpen
        );
        require!(clock.slot > round.reveal_slot, CrashError::SlotHashUnavailable);

        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        let hash = read_slot_hash(&data, round.reveal_slot)?;
        let crash_bps = crash_bps_from_hash(&hash);

        round.crash_bps = crash_bps;
        round.phase = PHASE_RESOLVED;
        let config = &mut ctx.accounts.config;
        config.phase = PHASE_RESOLVED;
        push_history(config, crash_bps);

        emit!(RoundLaunched {
            round_id: round.id,
            crash_bps,
        });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, round_id: u64) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(round.phase == PHASE_RESOLVED, CrashError::NotResolved);
        require!(round.id == round_id, CrashError::BadRound);
        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, CrashError::AlreadyClaimed);
        require!(bet.round_id == round_id, CrashError::BadRound);
        require!(
            bet.player == ctx.accounts.player.key(),
            CrashError::BadPlayer
        );

        let won = round.crash_bps > ONE_X_BPS && bet.cashout_bps < round.crash_bps;
        let payout = if won {
            u64::try_from(
                (bet.amount as u128)
                    .checked_mul(bet.cashout_bps as u128)
                    .ok_or(CrashError::Overflow)?
                    / 10_000u128,
            )
            .map_err(|_| error!(CrashError::Overflow))?
        } else {
            0
        };

        if payout > 0 {
            let rent = Rent::get()?.minimum_balance(0);
            require!(
                ctx.accounts.vault.lamports() >= payout.saturating_add(rent),
                CrashError::InsufficientLiquidity
            );
            let bump = ctx.bumps.vault;
            let signer: &[&[u8]] = &[b"vault", &[bump]];
            system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.player.to_account_info(),
                    },
                    &[signer],
                ),
                payout,
            )?;
        }

        bet.claimed = true;
        bet.payout = payout;
        emit!(BetSettled {
            player: bet.player,
            round_id: bet.round_id,
            payout,
            won,
        });
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, CrashError::BadAmount);
        require!(
            ctx.accounts.config.phase != PHASE_BETTING,
            CrashError::RoundInProgress
        );
        let rent = Rent::get()?.minimum_balance(0);
        require!(
            ctx.accounts.vault.lamports() >= amount.saturating_add(rent),
            CrashError::InsufficientLiquidity
        );
        let bump = ctx.bumps.vault;
        let signer: &[&[u8]] = &[b"vault", &[bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
                &[signer],
            ),
            amount,
        )?;
        Ok(())
    }
}

pub fn crash_bps_from_hash(hash: &[u8; 32]) -> u32 {
    if hash[0] % 20 == 0 {
        return ONE_X_BPS;
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&hash[0..8]);
    let h = u64::from_le_bytes(bytes) & ((1u64 << 52) - 1);
    let e = 1u64 << 52;
    if h >= e {
        return ONE_X_BPS;
    }
    let x100 = (100u128 * e as u128 - h as u128) / ((e - h) as u128);
    let bps = x100.saturating_mul(100);
    bps.clamp(ONE_X_BPS as u128, MAX_CRASH_BPS as u128) as u32
}

fn read_slot_hash(data: &[u8], slot: u64) -> Result<[u8; 32]> {
    const ENTRY: usize = 40;
    if data.len() < 8 {
        return err!(CrashError::SlotHashUnavailable);
    }
    let declared = u64::from_le_bytes(data[..8].try_into().unwrap()) as usize;
    let available = data.len().saturating_sub(8) / ENTRY;
    let len = declared.min(available);
    let mut lo = 0usize;
    let mut hi = len;
    while lo < hi {
        let mid = (lo + hi) / 2;
        let off = 8 + mid * ENTRY;
        let this_slot = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        match slot.cmp(&this_slot) {
            std::cmp::Ordering::Equal => {
                let mut hash = [0u8; 32];
                hash.copy_from_slice(&data[off + 8..off + 40]);
                return Ok(hash);
            }
            std::cmp::Ordering::Less => lo = mid + 1,
            std::cmp::Ordering::Greater => hi = mid,
        }
    }
    err!(CrashError::SlotHashUnavailable)
}

fn push_history(config: &mut Config, crash_bps: u32) {
    if (config.history_len as usize) < config.history.len() {
        config.history[config.history_len as usize] = crash_bps;
        config.history_len = config.history_len.saturating_add(1);
        return;
    }
    config.history.copy_within(1.., 0);
    let last = config.history.len() - 1;
    config.history[last] = crash_bps;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Config::SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    /// CHECK: empty system account created in the instruction to hold the bank.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: system-owned bank PDA created during initialize.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64, betting_seconds: u16)]
pub struct OpenRound<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = opener,
        space = 8 + Round::SPACE,
        seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(mut)]
    pub opener: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"round".as_ref(), config.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: system-owned bank PDA.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = player,
        space = 8 + Bet::SPACE,
        seeds = [b"bet", round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Launch<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"round".as_ref(), config.round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: SlotHashes sysvar. The address constraint pins the account.
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct Claim<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"bet", round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    /// CHECK: system-owned bank PDA.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    /// CHECK: system-owned bank PDA.
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub round_id: u64,
    pub phase: u8,
    pub bump: u8,
    pub history: [u32; 12],
    pub history_len: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 8 + 1 + 1 + 4 * 12 + 1;
}

#[account]
pub struct Round {
    pub id: u64,
    pub opened_slot: u64,
    pub reveal_slot: u64,
    pub betting_ends_at: i64,
    pub phase: u8,
    pub crash_bps: u32,
    pub total_wagered: u64,
    pub bump: u8,
}

impl Round {
    pub const SPACE: usize = 8 + 8 + 8 + 8 + 1 + 4 + 8 + 1;
}

#[account]
pub struct Bet {
    pub player: Pubkey,
    pub round_id: u64,
    pub amount: u64,
    pub cashout_bps: u32,
    pub claimed: bool,
    pub payout: u64,
    pub bump: u8,
}

impl Bet {
    pub const SPACE: usize = 32 + 8 + 8 + 4 + 1 + 8 + 1;
}

#[event]
pub struct RoundOpened {
    pub round_id: u64,
    pub betting_ends_at: i64,
    pub reveal_slot: u64,
}

#[event]
pub struct BetPlaced {
    pub player: Pubkey,
    pub round_id: u64,
    pub amount: u64,
    pub cashout_bps: u32,
}

#[event]
pub struct RoundLaunched {
    pub round_id: u64,
    pub crash_bps: u32,
}

#[event]
pub struct BetSettled {
    pub player: Pubkey,
    pub round_id: u64,
    pub payout: u64,
    pub won: bool,
}

#[error_code]
pub enum CrashError {
    #[msg("Bet amount is outside the table limits")]
    BadAmount,
    #[msg("Cash-out target must be between 1.01x and 50x")]
    BadCashout,
    #[msg("Betting window must be between 5 and 120 seconds")]
    BadDuration,
    #[msg("A round is already open")]
    RoundInProgress,
    #[msg("Unexpected round id")]
    BadRound,
    #[msg("Betting is not open")]
    NotBetting,
    #[msg("Betting window has closed")]
    BettingClosed,
    #[msg("Betting window is still open")]
    BettingOpen,
    #[msg("Crash point is not ready yet")]
    SlotHashUnavailable,
    #[msg("Round is not resolved")]
    NotResolved,
    #[msg("Bet was already settled")]
    AlreadyClaimed,
    #[msg("This bet belongs to another player")]
    BadPlayer,
    #[msg("The table cannot cover that payout yet")]
    InsufficientLiquidity,
    #[msg("Amount overflow")]
    Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_descending_slot_hash() {
        let mut data = vec![0u8; 8 + 40 * 3];
        data[..8].copy_from_slice(&3u64.to_le_bytes());
        for (i, slot) in [30u64, 20, 10].into_iter().enumerate() {
            let off = 8 + i * 40;
            data[off..off + 8].copy_from_slice(&slot.to_le_bytes());
            data[off + 8] = slot as u8;
        }
        let hash = read_slot_hash(&data, 20).unwrap();
        assert_eq!(hash[0], 20);
        assert!(read_slot_hash(&data, 21).is_err());
    }

    #[test]
    fn instant_bust_when_hash_is_divisible_by_twenty() {
        let mut hash = [7u8; 32];
        hash[0] = 40;
        assert_eq!(crash_bps_from_hash(&hash), ONE_X_BPS);
    }

    #[test]
    fn crash_point_stays_inside_the_cap() {
        let hash = [1u8; 32];
        let bps = crash_bps_from_hash(&hash);
        assert!(bps >= ONE_X_BPS && bps <= MAX_CRASH_BPS);
    }
}
