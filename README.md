# Solana Tip Jar - Setup Guide

This guide will help you deploy and test the Solana Tip Jar program using **Anchor**.

> ⚠️ Note: The `app` folder is optional. You only need it if you want a frontend to interact with the program.

---

## 1. Deploy the Program

1. Make sure you have installed all dependencies:  

   ```bash
   # Solana CLI
   solana --version

   # Rust
   rustc --version

   # Anchor CLI
   anchor --version

    Build and deploy the program once inside :

    anchor build
    anchor deploy

2. Update Program ID

After deployment, Anchor will generate an IDL file:

target/idl/tip_jar.json

    Open your lib.rs file.

    Replace the declare_id! with the address found in tip_jar.json. Example:

declare_id!("YourNewProgramIDHere");

    This ensures your program code references the correct deployed program.

3. Set the Owner

In your frontend or scripts (e.g., app/App.tsx), set the OWNER variable to your personal Solana wallet address:

const OWNER = new PublicKey("YourPersonalSolanaWalletPubkey");

This wallet will receive withdrawals from the Tip Jar.
4. Test

    Make sure your wallet has SOL on devnet:

solana airdrop 2

    Test the program using the frontend (app) or scripts:

cd app
npm install
npm run dev

    Connect Phantom Wallet and send tips to the jar.

    Check the total tipped amount in the frontend.

5. Dependencies

Make sure these are installed for the frontend:

    @solana/web3.js

    @coral-xyz/anchor

    @solana/wallet-adapter-react

    @solana/wallet-adapter-react-ui

For the program:

    Anchor CLI

    Solana CLI

    Rust toolchain


please feel free to add more features and play around with it
