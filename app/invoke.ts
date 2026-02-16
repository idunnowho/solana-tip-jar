import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TipJar } from "../target/types/tip_jar";

// ✅ Change this if needed
const PROGRAM_ID = new PublicKey("GjgVhkszdbEQ6NqwavvNLSDxtiez1itEJGnrfCycxTB6");

async function main() {
  // -----------------------------
  // Setup provider + wallet
  // -----------------------------
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TipJar as Program<TipJar>;

  const wallet = provider.wallet;
  console.log("Wallet:", wallet.publicKey.toBase58());

  // -----------------------------
  // Derive PDA (jar)
  // seeds = [b"jar", owner.key()]
  // -----------------------------
  const [jarPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("jar"),
      wallet.publicKey.toBuffer(),
    ],
    PROGRAM_ID
  );

  console.log("Jar PDA:", jarPda.toBase58());

  // -----------------------------
  // Initialize (only run once)
  // -----------------------------
  try {
    const txInit = await program.methods
      .initialize()
      .accounts({
        jar: jarPda,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    console.log("Initialize TX:", txInit);
  } catch (e) {
    console.log("Initialize skipped (likely already exists)");
  }

  // -----------------------------
  // Send a tip
  // -----------------------------
  const tipAmount = new anchor.BN(1_000_000); // 0.001 SOL

  const txTip = await program.methods
    .tip(tipAmount)
    .accounts({
      jar: jarPda,
      tipper: wallet.publicKey,
    } as any)
    .rpc();

  console.log("Tip TX:", txTip);

  // -----------------------------
  // Fetch account data
  // -----------------------------
  const jarAccount = await program.account.jar.fetch(jarPda);

  console.log("Total tipped:", jarAccount.totalTipped.toString());
}

main().catch(console.error);
