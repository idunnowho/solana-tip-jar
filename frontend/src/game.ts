import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export const PROGRAM_ID = new PublicKey("GxMvwW87a6AvD22YUHQfV25kFB4MzS8KHerjpHtJYVcA");

export const PHASE_IDLE = 0;
export const PHASE_BETTING = 1;
export const PHASE_RESOLVED = 2;

export const MIN_BET_SOL = 0.01;
export const MAX_BET_SOL = 1;
export const MIN_CASHOUT = 1.01;
export const MAX_CASHOUT = 50;

export function configPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function vaultPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0];
}

export function roundPda(roundId: number) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round"), new BN(roundId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  )[0];
}

export function betPda(round: PublicKey, player: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), round.toBuffer(), player.toBuffer()],
    PROGRAM_ID
  )[0];
}

export function bpsToX(bps: number) {
  return bps / 10_000;
}

export function xToBps(value: number) {
  return Math.round(value * 10_000);
}

export function multiplierAt(elapsedMs: number) {
  return Math.exp(0.06 * (elapsedMs / 1000));
}

export function formatSol(lamports: number) {
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
}

export function formatX(value: number) {
  return `${value.toFixed(2)}x`;
}

export function shorten(key: string) {
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
