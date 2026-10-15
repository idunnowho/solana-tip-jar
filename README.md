# Rift

A devnet crash game. You lock a cash-out multiplier, a future slot hash sets the crash point, and the chart flies until it busts.

Devnet SOL has no real-world value. The table keeps a 1-in-20 instant bust and caps the crash at 50x. Cash-out targets from 1.01x through 50x win only when they are strictly below the crash point.

## Play

1. Install Solana CLI 2.3.0, Anchor CLI 0.32.1, and Rust 1.89.0.
2. Build and deploy:

```bash
anchor build
anchor deploy --provider.cluster devnet
```

3. Initialize and seed the bank once (the deployer wallet needs devnet SOL):

```bash
npx ts-node scripts/bootstrap-devnet.ts
```

4. Start the table:

```bash
cd frontend
npm install
npm run dev
```

Open the app, set your wallet to Devnet, and place a bet before the countdown ends. The connected wallet launches the round and settles your bet when the flight finishes.

Program id: `GxMvwW87a6AvD22YUHQfV25kFB4MzS8KHerjpHtJYVcA`

## Test locally

```bash
anchor test --provider.cluster localnet
```
