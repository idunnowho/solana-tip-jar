import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Crash } from "../target/types/crash";
import { assert } from "chai";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

describe("crash", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.crash as Program<Crash>;
  const player = provider.wallet;
  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  )[0];
  const vaultPda = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  )[0];

  const roundPda = (id: number) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("round"), new anchor.BN(id).toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const betPda = (round: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("bet"), round.toBuffer(), player.publicKey.toBuffer()],
      program.programId
    )[0];

  it("initializes the table and accepts liquidity", async () => {
    await program.methods
      .initialize()
      .accounts({
        config: configPda,
        vault: vaultPda,
        authority: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .fund(new anchor.BN(2 * LAMPORTS_PER_SOL))
      .accounts({
        config: configPda,
        vault: vaultPda,
        funder: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.phase, 0);
    assert.equal(config.roundId.toNumber(), 0);
    const vault = await provider.connection.getBalance(vaultPda);
    assert.isAtLeast(vault, 2 * LAMPORTS_PER_SOL);
  });

  it("locks a cash-out, then settles against the revealed crash point", async () => {
    const roundId = 1;
    const round = roundPda(roundId);
    const bet = betPda(round);
    const wager = 0.05 * LAMPORTS_PER_SOL;
    const cashoutBps = 15_000;

    await program.methods
      .openRound(new anchor.BN(roundId), 5)
      .accounts({
        config: configPda,
        round,
        opener: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .placeBet(new anchor.BN(wager), cashoutBps)
      .accounts({
        config: configPda,
        round,
        vault: vaultPda,
        bet,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .placeBet(new anchor.BN(wager), cashoutBps)
        .accounts({
          config: configPda,
          round,
          vault: vaultPda,
          bet,
          player: player.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("second bet should not land");
    } catch (error) {
      assert.include(String(error), "already in use");
    }

    let launched = false;
    for (let attempt = 0; attempt < 15 && !launched; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await program.methods
          .launch()
          .accounts({
            config: configPda,
            round,
            slotHashes: SLOT_HASHES,
          })
          .rpc();
        launched = true;
      } catch (error) {
        const text = String(error);
        if (!text.includes("still open") && !text.includes("not ready")) {
          throw error;
        }
      }
    }
    assert.isTrue(launched, "round should launch after the betting window");

    const resolved = await program.account.round.fetch(round);
    assert.equal(resolved.phase, 2);
    assert.isAtLeast(resolved.crashBps, 10_000);
    assert.isAtMost(resolved.crashBps, 500_000);

    const before = await provider.connection.getBalance(player.publicKey);
    await program.methods
      .claim(new anchor.BN(roundId))
      .accounts({
        config: configPda,
        round,
        bet,
        vault: vaultPda,
        player: player.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const after = await provider.connection.getBalance(player.publicKey);
    const stored = await program.account.bet.fetch(bet);
    assert.isTrue(stored.claimed);

    const won = cashoutBps < resolved.crashBps && resolved.crashBps > 10_000;
    if (won) {
      const expected = Math.floor((wager * cashoutBps) / 10_000);
      assert.equal(stored.payout.toNumber(), expected);
      assert.isAbove(after, before);
    } else {
      assert.equal(stored.payout.toNumber(), 0);
    }

    const config = await program.account.config.fetch(configPda);
    assert.equal(config.historyLen, 1);
    assert.equal(config.history[0], resolved.crashBps);
  });
});
