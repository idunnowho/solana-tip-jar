import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crash } from "../target/types/crash";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.crash as Program<Crash>;
  const authority = provider.wallet.publicKey;
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault")], program.programId)[0];

  const existing = await provider.connection.getAccountInfo(config);
  if (!existing) {
    const signature = await program.methods
      .initialize()
      .accounts({
        config,
        vault,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Initialized", signature);
  } else {
    console.log("Config already exists", config.toBase58());
  }

  const signature = await program.methods
    .fund(new anchor.BN(LAMPORTS_PER_SOL))
    .accounts({
      config,
      vault,
      funder: authority,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("Funded 1 SOL", signature);
  console.log("Vault", vault.toBase58(), "lamports", await provider.connection.getBalance(vault));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
