import { NonceManager } from "@ethersproject/experimental";
import hre, { ethers } from "hardhat";

import TermAuctionBidLockerABI from "../abi/TermAuctionBidLocker.json";
import TermRepoRolloverManagerABI from "../abi/TermRepoRolloverManager.json";

import {
  TermAuctionBidLocker,
  TermRepoRolloverManager,
} from "../typechain-types";
import { getEnv } from "./deploy-utils";
import { Signer } from "ethers";

export interface PreviousTerm {
  readonly rolloverManagerAddress: string;
}

export interface NextTerm {
  readonly termAuctionBidLockerAddress: string;
  readonly auctionAddress: string;
}

export async function approveRollover(
  previousTerm: PreviousTerm,
  nextTerm: NextTerm,
  signer?: Signer,
) {
  const [defaultSigner] = await ethers.getSigners();

  const managedSigner = signer || new NonceManager(defaultSigner as any);

  const rolloverManager = (await ethers.getContractAt(
    TermRepoRolloverManagerABI,
    previousTerm.rolloverManagerAddress,
    managedSigner,
  )) as TermRepoRolloverManager;

  const auctionBidLocker = (await ethers.getContractAt(
    TermAuctionBidLockerABI,
    nextTerm.termAuctionBidLockerAddress,
    managedSigner,
  )) as TermAuctionBidLocker;

  console.log(
    `Pairing term rollover manager %s and associated manager contracts to term auction address %s and term bid locker %s`,
    previousTerm.rolloverManagerAddress,
    nextTerm.auctionAddress,
    nextTerm.termAuctionBidLockerAddress,
  );

  await rolloverManager.approveRolloverAuction(
    nextTerm.termAuctionBidLockerAddress,
  );

  console.log(
    `Pairing term bid locker %s to past rollover manager %s`,
    nextTerm.termAuctionBidLockerAddress,
    previousTerm.rolloverManagerAddress,
  );

  await auctionBidLocker.pairRolloverManager(
    previousTerm.rolloverManagerAddress,
  );
}

const previousTermRepoRolloverManager = getEnv(
  "PREVIOUS_TERM_ROLLOVER_MANAGER",
  "",
);
const nextTermAuction = getEnv(
  "NEXT_TERM_AUCTION",
  "defaultGnosisSafeProtocolReservesWalletAddress",
);
const nextTermAuctionBidLocker = getEnv("NEXT_TERM_AUCTION_BID_LOCKER", "");

async function main() {
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  await hre.run("compile");

  // Deploy a new maturity period.
  await approveRollover(
    { rolloverManagerAddress: previousTermRepoRolloverManager },
    {
      auctionAddress: nextTermAuction,
      termAuctionBidLockerAddress: nextTermAuctionBidLocker,
    },
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
