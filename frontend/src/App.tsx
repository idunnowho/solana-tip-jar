import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { useEffect, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../../target/idl/tip_jar.json";

const PROGRAM_ID = new PublicKey("GjgVhkszdbEQ6NqwavvNLSDxtiez1itEJGnrfCycxTB6");

// 🔥 IMPORTANT: Replace with YOUR owner pubkey
const OWNER = new PublicKey("E7xUZZBvnDu5d3cPTyPCBaGCS9wuAiPRWC3yzR4RQPFz");

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [total, setTotal] = useState<number>(0);

  const getProvider = () => {
    return new anchor.AnchorProvider(
      connection,
      wallet as any,
      { commitment: "confirmed" }
    );
  };

  const getProgram = () => {
    const provider = getProvider();
    return new anchor.Program(idl as anchor.Idl, provider);
  };

  const getJarPda = (program: anchor.Program) => {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("jar"),
        OWNER.toBuffer(),
      ],
      program.programId
    )[0];
  };

  const initializeJar = async () => {
    if (!wallet.publicKey) return;

    const program = getProgram();
    const jarPda = getJarPda(program);

    try {
      await program.methods
        .initialize()
        .accounts({
          jar: jarPda,
          owner: OWNER,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Jar initialized");
    } catch (err) {
      console.log("Jar already exists");
    }
  };


   // Sends a tip of 0.5 SOL to the jar
  const sendTip = async () => {
  if (!wallet.publicKey) return;

  const program = getProgram();
  const jarPda = getJarPda(program);

  try {
    const tx = await program.methods
      .tip(new anchor.BN(500_000_000)) // Tip of 0.5 SOL
      .accounts({
        jar: jarPda,
        tipper: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("TX:", tx);
    fetchTotal();
  } catch (err) {
    console.error("TIP ERROR:", err);
  }
};


  const fetchTotal = async () => {
    const program = getProgram();
    const jarPda = getJarPda(program);

    try {
      const account = await (program.account as any).jar.fetch(jarPda);
      setTotal(account.totalTipped.toNumber() / anchor.web3.LAMPORTS_PER_SOL);
    } catch (err) {
      console.log("Jar not found yet");
    }
  };

  useEffect(() => {
    if (wallet.connected) {
      initializeJar();
      fetchTotal();
    }
  }, [wallet.connected]);

  return (
    <div style={{ padding: 40 }}>
      <h1>Solana Tip Jar</h1>
      <WalletMultiButton />

      <div style={{ marginTop: 20 }}>
        <p>Total Tipped: {total} SOL</p>

        <button onClick={sendTip}>
          Send 0.5 SOL
        </button>
      </div>
    </div>
  );
}
