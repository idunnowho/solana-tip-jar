# Solana Tip Jar

A simple **Solana Tip Jar** example using **Anchor**, **React**, and **Phantom Wallet**.  
This project demonstrates creating a PDA (program-derived account), sending SOL tips, and viewing totals.  

> ⚠️ Note: The OWNER public key in this repo is a placeholder (`11111111111111111111111111111111`). Replace with your own wallet for actual withdrawals.

---

## Table of Contents

1. [Prerequisites](#prerequisites)  
2. [Clone the Repo](#clone-the-repo)  
3. [Install Dependencies](#install-dependencies)  
4. [Set Up Environment](#set-up-environment)  
5. [Build and Deploy the Program (Optional)](#build-and-deploy-the-program-optional)  
6. [Run the Frontend](#run-the-frontend)  
7. [How it Works](#how-it-works)  
8. [Notes / Safety](#notes--safety)  

---

## Prerequisites

Make sure you have installed:

1. **Node.js & npm**  
   ```bash
   node -v
   npm -v

Recommended: Node.js v20+

    Rust (for Anchor programs)

rustup --version
rustc --version

Install: https://www.rust-lang.org/tools/install

Solana CLI

solana --version

Install: https://docs.solana.com/cli/install-solana-cli-tools

Anchor CLI

anchor --version

Install:

    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install latest
    avm use latest

    Phantom Wallet (for testing the frontend)

Clone the Repo

git clone https://github.com/idunnowho/solana-tip-jar.git
cd solana-tip-jar

Install Dependencies
1. Frontend (React)

cd app
npm install

Packages included:

    @solana/wallet-adapter-react

    @solana/wallet-adapter-react-ui

    @solana/web3.js

    @coral-xyz/anchor

2. Anchor / Solana Program

cd ../program
cargo build-bpf    # or `anchor build`

Set Up Environment

Create a .env file in the frontend folder:

# Frontend placeholder for OWNER pubkey
REACT_APP_OWNER_PUBKEY=11111111111111111111111111111111

# Optional: point to devnet
REACT_APP_SOLANA_NETWORK=devnet

    ⚠️ Replace REACT_APP_OWNER_PUBKEY with your wallet if you want to withdraw funds.

Build and Deploy the Program (Optional)

If you want to deploy the Tip Jar smart contract yourself:

cd program
anchor build
solana program deploy target/deploy/tip_jar.so

    Save the program ID returned — this is what your frontend PROGRAM_ID should use.

    Make sure your wallet has SOL on devnet:

    solana airdrop 2

Run the Frontend

cd app
npm run dev

    Open the app in the browser (default http://localhost:5173).

    Connect Phantom Wallet.

    Click “Send Tip” to tip the PDA.

    Total tips will be displayed on the page.

How it Works

    Initialize PDA:

        The frontend computes a PDA using the OWNER key and “jar” seed.

        If it doesn’t exist, initialize() is called to create it.

    Send Tip:

        tip(amount) sends SOL from your connected wallet to the PDA.

        Updates total tipped.

    Withdraw (if implemented):

        The smart contract can have a withdraw() function to send funds to the OWNER.

        Only the OWNER public key can receive withdrawals.

Notes / Safety

    This repo does not include a real wallet. The OWNER pubkey is a placeholder.

    Anyone can fork this repo and test on devnet safely.

    Always double-check transaction amounts before sending real SOL.

    The PDA is program-controlled, meaning the only way to withdraw is through the program logic