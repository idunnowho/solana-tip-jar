import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import * as anchor from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../../target/idl/crash.json";
import Chart from "./Chart";
import {
  betPda,
  bpsToX,
  configPda,
  formatSol,
  formatX,
  MAX_BET_SOL,
  MAX_CASHOUT,
  MIN_BET_SOL,
  MIN_CASHOUT,
  PHASE_BETTING,
  PHASE_RESOLVED,
  roundPda,
  vaultPda,
  xToBps,
} from "./game";

const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");

type ConfigAccount = { roundId: anchor.BN; historyLen: number; history: number[] };
type RoundAccount = {
  phase: number;
  bettingEndsAt: anchor.BN;
  crashBps: number;
  totalWagered: anchor.BN;
};
type BetAccount = {
  amount: anchor.BN;
  cashoutBps: number;
  claimed: boolean;
  payout: anchor.BN;
};
type Accounts = {
  config: { fetch: (key: PublicKey) => Promise<ConfigAccount> };
  round: { fetch: (key: PublicKey) => Promise<RoundAccount> };
  bet: { fetch: (key: PublicKey) => Promise<BetAccount> };
};

type Stage = "lobby" | "betting" | "flying" | "crashed";

type RoundView = {
  id: number;
  phase: number;
  bettingEndsAt: number;
  crashBps: number;
  totalWagered: number;
};

type BetView = {
  amount: number;
  cashoutBps: number;
  claimed: boolean;
  payout: number;
};

function messageOf(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const named = text.match(/Error Message: ([^\n.]+)/);
  return named?.[1] ?? text.split("\n")[0] ?? "Transaction failed";
}

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const [stage, setStage] = useState<Stage>("lobby");
  const [multiplier, setMultiplier] = useState(1);
  const [round, setRound] = useState<RoundView | null>(null);
  const [bet, setBet] = useState<BetView | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [balance, setBalance] = useState(0);
  const [liquidity, setLiquidity] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [amount, setAmount] = useState(0.05);
  const [cashout, setCashout] = useState(2);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [watchedId, setWatchedId] = useState(0);
  const launching = useRef(false);
  const claimedRound = useRef(0);

  const program = useMemo(() => {
    if (!anchorWallet) return null;
    const provider = new anchor.AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed",
    });
    return new anchor.Program(idl as anchor.Idl, provider);
  }, [anchorWallet, connection]);

  const refresh = useCallback(async () => {
    const configKey = configPda();
    const info = await connection.getAccountInfo(configKey);
    setInitialized(Boolean(info));
    if (!info || !program) {
      setLiquidity(await connection.getBalance(vaultPda()));
      return;
    }
    const accounts = program.account as unknown as Accounts;
    const config = await accounts.config.fetch(configKey);
    const roundId = Number(config.roundId);
    const historyLen = Number(config.historyLen);
    setHistory((config.history as number[]).slice(0, historyLen));
    setLiquidity(await connection.getBalance(vaultPda()));
    if (wallet.publicKey) {
      setBalance(await connection.getBalance(wallet.publicKey));
    }
    if (roundId === 0) {
      setRound(null);
      setBet(null);
      setStage("lobby");
      return;
    }
    const roundKey = roundPda(roundId);
    const onchain = await accounts.round.fetch(roundKey);
    const nextRound: RoundView = {
      id: roundId,
      phase: Number(onchain.phase),
      bettingEndsAt: Number(onchain.bettingEndsAt),
      crashBps: Number(onchain.crashBps),
      totalWagered: Number(onchain.totalWagered),
    };
    setRound(nextRound);
    if (wallet.publicKey) {
      const betKey = betPda(roundKey, wallet.publicKey);
      const betInfo = await connection.getAccountInfo(betKey);
      if (!betInfo) setBet(null);
      else {
        const stored = await accounts.bet.fetch(betKey);
        setBet({
          amount: Number(stored.amount),
          cashoutBps: Number(stored.cashoutBps),
          claimed: Boolean(stored.claimed),
          payout: Number(stored.payout),
        });
      }
    }
    if (nextRound.phase === PHASE_BETTING) {
      setStage("betting");
      setMultiplier(1);
      setWatchedId(roundId);
    } else if (nextRound.phase === PHASE_RESOLVED && watchedId !== roundId) {
      setStage("crashed");
      setMultiplier(bpsToX(nextRound.crashBps));
    }
  }, [connection, program, wallet.publicKey, watchedId]);

  useEffect(() => {
    const kick = window.setTimeout(() => {
      refresh().catch((cause) => setError(messageOf(cause)));
    }, 0);
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!round || round.phase !== PHASE_BETTING) return;
    const tick = () => setSecondsLeft(Math.max(0, round.bettingEndsAt - Math.floor(Date.now() / 1000)));
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [round]);

  useEffect(() => {
    if (stage !== "flying" || !round) return;
    const crashAt = bpsToX(round.crashBps);
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const next = Math.exp(0.06 * ((now - started) / 1000));
      if (next >= crashAt) {
        setMultiplier(crashAt);
        setStage("crashed");
        return;
      }
      setMultiplier(next);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [round, stage]);

  useEffect(() => {
    if (!program || !round || launching.current) return;
    if (round.phase !== PHASE_BETTING || secondsLeft !== 0 || stage !== "betting") return;
    launching.current = true;
    program.methods
      .launch()
      .accounts({
        config: configPda(),
        round: roundPda(round.id),
        slotHashes: SLOT_HASHES,
      })
      .rpc()
      .then(() => {
        setStage("flying");
        return refresh();
      })
      .catch((cause) => {
        const text = messageOf(cause);
        if (!text.includes("still open") && !text.includes("not ready")) setError(text);
      })
      .finally(() => {
        launching.current = false;
      });
  }, [program, refresh, round, secondsLeft, stage]);

  useEffect(() => {
    if (!program || !round || !bet || bet.claimed || stage !== "crashed") return;
    if (!wallet.publicKey || claimedRound.current === round.id) return;
    claimedRound.current = round.id;
    program.methods
      .claim(new anchor.BN(round.id))
      .accounts({
        config: configPda(),
        round: roundPda(round.id),
        bet: betPda(roundPda(round.id), wallet.publicKey!),
        vault: vaultPda(),
        player: wallet.publicKey!,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
      .then(() => refresh())
      .catch((cause) => setError(messageOf(cause)));
  }, [bet, program, refresh, round, stage, wallet.publicKey]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const potentialLamports = Math.round(amount * cashout * LAMPORTS_PER_SOL);
  const payoutFits = potentialLamports + 1_000_000 < liquidity;
  const cashoutAt = bet ? bpsToX(bet.cashoutBps) : stage === "betting" ? cashout : null;
  const crashAt = round && round.phase === PHASE_RESOLVED ? bpsToX(round.crashBps) : null;
  const headline =
    stage === "crashed" && crashAt
      ? formatX(crashAt)
      : stage === "flying" || stage === "betting"
        ? formatX(multiplier)
        : "1.00x";

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <h1>RIFT</h1>
          <span className="badge">Devnet</span>
        </div>
        <div className="brand">
          <span className="ghost">{formatSol(balance)} SOL</span>
          <WalletMultiButton />
        </div>
      </header>

      <section className="layout">
        <div className={`stage ${stage}`}>
          <Chart phase={stage} multiplier={multiplier} crashAt={crashAt} cashoutAt={cashoutAt} />
          <div className="stage-head">
            <span className="badge">{stage === "betting" ? `${secondsLeft}s` : stage}</span>
            <span className="ghost">Bank {formatSol(liquidity)} SOL</span>
          </div>
          <div className="readout">
            <div>
              <p className="kicker">
                {stage === "crashed" ? "Crashed" : stage === "flying" ? "In flight" : "Next flight"}
              </p>
              <p className={`multiplier ${stage === "crashed" ? "bust" : "live"}`}>{headline}</p>
              <p className="fine">
                {bet
                  ? `Your target ${formatX(bpsToX(bet.cashoutBps))} on ${formatSol(bet.amount)} SOL`
                  : "Lock a target before the curve leaves the pad."}
              </p>
            </div>
          </div>
        </div>

        <aside className="panel">
          <h2>Place a bet</h2>
          <p>Set your wallet to Devnet. Wins pay from the public bank.</p>
          <label htmlFor="amount">Amount</label>
          <input
            id="amount"
            type="number"
            min={MIN_BET_SOL}
            max={MAX_BET_SOL}
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
          <div className="presets">
            {[0.05, 0.1, 0.25, 0.5].map((preset) => (
              <button key={preset} type="button" onClick={() => setAmount(preset)}>
                {preset}
              </button>
            ))}
          </div>
          <label htmlFor="cashout">Auto cash-out {formatX(cashout)}</label>
          <input
            id="cashout"
            type="range"
            min={MIN_CASHOUT}
            max={MAX_CASHOUT}
            step="0.01"
            value={cashout}
            onChange={(event) => setCashout(Number(event.target.value))}
          />
          <div className="payout">
            <span>If it holds</span>
            <strong>{(amount * cashout).toFixed(3)} SOL</strong>
          </div>
          {!initialized ? (
            <button
              className="primary"
              type="button"
              disabled={!program || busy}
              onClick={() =>
                run(() =>
                  program!.methods
                    .initialize()
                    .accounts({
                      config: configPda(),
                      vault: vaultPda(),
                      authority: wallet.publicKey!,
                      systemProgram: SystemProgram.programId,
                    })
                    .rpc()
                )
              }
            >
              Open the table
            </button>
          ) : (
            <>
              <button
                className="primary"
                type="button"
                disabled={!program || busy || stage !== "betting" || Boolean(bet) || !payoutFits}
                onClick={() =>
                  run(() =>
                    program!.methods
                      .placeBet(new anchor.BN(Math.round(amount * LAMPORTS_PER_SOL)), xToBps(cashout))
                      .accounts({
                        config: configPda(),
                        round: roundPda(round!.id),
                        vault: vaultPda(),
                        bet: betPda(roundPda(round!.id), wallet.publicKey!),
                        player: wallet.publicKey!,
                        systemProgram: SystemProgram.programId,
                      })
                      .rpc()
                  )
                }
              >
                {bet ? "Target locked" : "Lock bet"}
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!program || busy || stage === "betting"}
                onClick={() =>
                  run(async () => {
                    const nextId = (round?.id ?? 0) + 1;
                    await program!.methods
                      .openRound(new anchor.BN(nextId), 20)
                      .accounts({
                        config: configPda(),
                        round: roundPda(nextId),
                        opener: wallet.publicKey!,
                        systemProgram: SystemProgram.programId,
                      })
                      .rpc();
                    setWatchedId(0);
                  })
                }
              >
                Start 20s round
              </button>
            </>
          )}
          <button
            className="secondary"
            type="button"
            disabled={!program || busy || !initialized}
            onClick={() =>
              run(() =>
                program!.methods
                  .fund(new anchor.BN(0.25 * LAMPORTS_PER_SOL))
                  .accounts({
                    config: configPda(),
                    vault: vaultPda(),
                    funder: wallet.publicKey!,
                    systemProgram: SystemProgram.programId,
                  })
                  .rpc()
              )
            }
          >
            Add 0.25 SOL liquidity
          </button>
          {!payoutFits && initialized ? (
            <p className="error">That cash-out is larger than the bank. Lower the target or add liquidity.</p>
          ) : null}
          {error ? <p className="error">{error}</p> : null}
        </aside>
      </section>

      <div className="history" aria-label="Recent crashes">
        {history.length === 0 ? <span className="chip">No flights yet</span> : null}
        {history.map((bps, index) => (
          <span key={`${bps}-${index}`} className={bps > 10_000 ? "chip win" : "chip loss"}>
            {formatX(bpsToX(bps))}
          </span>
        ))}
      </div>
    </main>
  );
}
