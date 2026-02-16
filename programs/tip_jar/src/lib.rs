use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("11111111111111111111111111111111"); // Placeholder, will be replaced by Anchor during deployment or change to your actual program ID

#[program]
pub mod tip_jar {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let jar = &mut ctx.accounts.jar;
        jar.owner = ctx.accounts.owner.key();
        jar.total_tipped = 0;
        jar.bump = ctx.bumps.jar;
        Ok(())
    }

    pub fn tip(ctx: Context<Tip>, amount: u64) -> Result<()> {
        // Transfer lamports from the tipper to the jar
        let cpi_accounts = Transfer {
            from: ctx.accounts.tipper.to_account_info(),
            to: ctx.accounts.jar.to_account_info(),
        };
        let cpi_program = ctx.accounts.system_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        transfer(cpi_ctx, amount)?;

        // Update total
        let jar = &mut ctx.accounts.jar;
        jar.total_tipped = jar
            .total_tipped
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(TipEvent {
            tipper: ctx.accounts.tipper.key(),
            jar: ctx.accounts.jar.key(),
            amount,
        });
    
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8 + 1, // discriminator + Pubkey + u64 + bump
        seeds = [b"jar", owner.key().as_ref()],
        bump
    )]
    pub jar: Account<'info, Jar>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Tip<'info> {
    #[account(mut)]
    pub jar: Account<'info, Jar>,
    #[account(mut)]
    pub tipper: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub jar: Account<'info, Jar>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Jar {
    pub owner: Pubkey,
    pub total_tipped: u64,
    pub bump: u8,
}

#[event]
pub struct TipEvent {
    pub tipper: Pubkey,
    pub jar: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawEvent {
    pub owner: Pubkey,
    pub amount: u64,
}