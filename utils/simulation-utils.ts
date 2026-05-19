import { parse } from "csv-parse";
import {
  FixedNumber,
  Signer,
  BigNumberish,
  BaseContract,
  solidityPackedKeccak256,
  ZeroAddress,
  keccak256,
  toUtf8Bytes,
  formatUnits,
} from "ethers";
import { ethers } from "hardhat";
import IERC20MetadataABI from "../abi/IERC20Metadata.json";
import TermAuctionBidLockerABI from "../abi/TermAuctionBidLocker.json";
import TermAuctionOfferLockerABI from "../abi/TermAuctionOfferLocker.json";
import {
  TermAuctionBidLocker,
  TermAuctionBidStruct,
  TermAuctionBidSubmissionStruct,
} from "../typechain-types/contracts/TermAuctionBidLocker";
import {
  TermAuctionOfferLocker,
  TermAuctionOfferStruct,
  TermAuctionOfferSubmissionStruct,
} from "../typechain-types/contracts/TermAuctionOfferLocker";
import { IERC20Metadata } from "../typechain-types";
import { CompleteAuctionInputStruct } from "../typechain-types/contracts/TermAuction";
import { randomInt } from "crypto";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { commify } from "./commify";

export const testDecimals = 17;

export type TenderReveal = {
  id: string;
  tenderPrice: string;
  nonce: string;
};

export async function lockRandomizedTenders(
  bidLocker: TermAuctionBidLocker,
  offerLocker: TermAuctionOfferLocker,
  numOfTenders: number,
  minTenderAmount: number,
  signers: SignerWithAddress[],
  purchaseToken: string,
  collateralTokens: string[],
): Promise<[TenderReveal[], TenderReveal[]]> {
  const bidPrices = [];
  const offerPrices = [];
  for (let i = 0; i < numOfTenders; i++) {
    const bidderWallet = signers[randomInt(0, signers.length)];
    const bidder = await bidderWallet.getAddress();
    const bidAmount =
      randomInt(minTenderAmount, 20000000).toString() + "0".repeat(18);
    const bidPriceRevealed = randomInt(1, 100).toString() + "0".repeat(16);
    const bidPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [bidPriceRevealed, "12345"],
    );
    const bidId = getBytesHash(randomInt(0, 10000000).toString());
    bidPrices.push({
      id: await getGeneratedTenderId(bidId, bidLocker, bidderWallet),
      tenderPrice: bidPriceRevealed,
      nonce: "12345",
    });
    const bid: TermAuctionBidSubmissionStruct = {
      id: bidId,
      amount: bidAmount,
      bidPriceHash,
      bidder,
      purchaseToken,
      collateralAmounts: [bidAmount],
      collateralTokens,
    };
    await bidLocker.connect(bidderWallet).lockBids([bid]);
    console.log(
      `locked bid for bidder ${bidder} with details ${JSON.stringify(bid)}`,
    );

    const offerorWallet = signers[randomInt(0, signers.length)];
    const offeror = await offerorWallet.getAddress();
    const offerAmount =
      randomInt(minTenderAmount, 20000000).toString() + "0".repeat(18);
    const offerPriceRevealed = randomInt(1, 100).toString() + "0".repeat(16);
    const offerPriceHash = solidityPackedKeccak256(
      ["uint256", "uint256"],
      [offerPriceRevealed, "12345"],
    );
    const offerId = getBytesHash(randomInt(0, 10000000).toString());
    offerPrices.push({
      id: await getGeneratedTenderId(offerId, offerLocker, offerorWallet),
      tenderPrice: offerPriceRevealed,
      nonce: "12345",
    });
    const offer: TermAuctionOfferSubmissionStruct = {
      id: offerId,
      amount: offerAmount,
      offerPriceHash,
      offeror,
      purchaseToken,
    };
    await offerLocker.connect(offerorWallet).lockOffers([offer]);
    console.log(
      `locked offer for offeror ${offeror} with details ${JSON.stringify(
        offer,
      )}`,
    );
  }
  return [bidPrices, offerPrices];
}

export function parsePrice(price: string): string {
  const retVal = FixedNumber.fromString(price, `fixed128x${testDecimals}`)
    .mulUnsafe(
      FixedNumber.fromString(
        "1" + "0".repeat(testDecimals),
        `fixed128x${testDecimals}`,
      ),
    )
    .round(0)
    .toString();
  return retVal.substring(0, retVal.length - 2);
}

export function getBytesHash(input: string): string {
  return keccak256(toUtf8Bytes(input));
}

export async function getGeneratedTenderId(
  input: string,
  contract: BaseContract,
  wallet: Signer,
) {
  return solidityPackedKeccak256(
    ["bytes32", "address", "address"],
    [
      input,
      await wallet.getAddress(),
      (await contract.getAddress()).toLowerCase(),
    ],
  );
}

export function parseBidsOffers(
  csv: string,
  purchaseToken: string,
  collateralToken: string,
  wallets: SignerWithAddress[] = [],
  delimiter: string = "\t",
): Promise<{
  bids: TermAuctionBidStruct[];
  offers: TermAuctionOfferStruct[];
}> {
  return new Promise((resolve, reject) => {
    const parser = parse({
      delimiter,
    });
    const rows: string[][] = [];

    // Use the readable stream api to consume records
    parser.on("readable", function () {
      let record;
      while ((record = parser.read()) !== null) {
        rows.push(record);
      }
    });

    // Catch any error
    parser.on("error", function (err) {
      reject(err);
    });

    parser.on("end", function () {
      // Convert csv to json
      const bids: TermAuctionBidStruct[] = [];
      const offers: TermAuctionOfferStruct[] = [];
      for (const row of rows) {
        if (row[3] && row[4] && row[5]) {
          const bid: TermAuctionBidStruct = {
            id: getBytesHash(`test-bid-${bids.length + 1}`),
            // bidder: wallets[parseInt(row[3]) - 1].address,
            bidder: !wallets?.length
              ? row[3]
              : wallets[parseInt(row[3]) - 1].address,
            bidPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              [parsePrice(row[5]), "12345"],
            ),
            bidPriceRevealed: parsePrice(row[5]),
            amount: row[4],
            collateralAmounts: [((BigInt(row[4]) * 3n) / 2n).toString()],
            purchaseToken,
            collateralTokens: [collateralToken],
            isRevealed: true,
            isRollover: false,
            rolloverPairOffTermRepoServicer: ZeroAddress,
          };
          bids.push(bid);
        }
      }
      for (const row of rows) {
        if (row[0] && row[1] && row[2]) {
          const offer: TermAuctionOfferStruct = {
            id: getBytesHash(`test-offer-${offers.length + 1}`),
            // offeror: wallets[parseInt(row[0]) - 1 + bids.length].address,
            offeror: !wallets?.length
              ? row[0]
              : wallets[parseInt(row[0]) - 1 + bids.length].address,
            offerPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              [parsePrice(row[2]), "678910"],
            ),
            offerPriceRevealed: parsePrice(row[2]),
            amount: row[1],
            purchaseToken,
            isRevealed: true,
          };
          offers.push(offer);
        }
      }

      bids.sort((a, b) => {
        const diff = BigInt(a.bidPriceRevealed) - BigInt(b.bidPriceRevealed);
        if (diff === 0n) {
          return 0;
        }
        return diff < 0n ? -1 : 1;
      });
      offers.sort((a, b) => {
        const diff =
          BigInt(a.offerPriceRevealed) - BigInt(b.offerPriceRevealed);
        if (diff === 0n) {
          return 0;
        }
        return diff < 0n ? -1 : 1;
      });

      resolve({ bids, offers });
    });

    const success = parser.write(csv);
    if (!success) {
      reject(new Error("Failed to parse csv"));
    }
    parser.end();
  });
}

export function bidToSubmission(bid: TermAuctionBidStruct) {
  return {
    id: bid.id,
    amount: bid.amount,
    bidder: bid.bidder,
    bidPriceHash: bid.bidPriceHash,
    collateralAmounts: bid.collateralAmounts,
    purchaseToken: bid.purchaseToken,
    collateralTokens: bid.collateralTokens,
  } as TermAuctionBidSubmissionStruct;
}

export function offerToSubmission(offer: TermAuctionOfferStruct) {
  return {
    id: offer.id,
    amount: offer.amount,
    offeror: offer.offeror,
    offerPriceHash: offer.offerPriceHash,
    purchaseToken: offer.purchaseToken,
  } as TermAuctionOfferSubmissionStruct;
}

export async function approveTokens(
  tokenAddresses: string[],
  signers: Signer[],
  spenderAddress: string,
  approveAmount: BigNumberish = "1" + "0".repeat(30),
) {
  for (const signer of signers) {
    for (const tokenAddress of tokenAddresses) {
      const token = (await ethers.getContractAt(
        IERC20MetadataABI,
        tokenAddress,
        signer,
      )) as unknown as IERC20Metadata;

      const signerAddress = await signer.getAddress();

      const approveAmountBn = BigInt(approveAmount);
      const allowance = await token.allowance(signerAddress, spenderAddress);
      if (allowance < approveAmountBn) {
        const tokenSymbol = await token.symbol();
        const tokenDecimals = await token.decimals();

        console.log(
          `Approving ${commify(
            formatUnits(approveAmount, tokenDecimals),
          )} ${tokenSymbol} for: ${signerAddress}. Allowance was: ${commify(
            formatUnits(allowance, tokenDecimals),
          )} ${tokenSymbol}`,
        );
        const tx = await token.approve(spenderAddress, approveAmount);
        await tx.wait();
      }
    }
  }
}

export async function filterAlreadyLockedBids(
  bidLockerAddress: string,
  bids: TermAuctionBidStruct[],
  keepLocked = false,
) {
  const bidLocker = (await ethers.getContractAt(
    TermAuctionBidLockerABI,
    bidLockerAddress,
  )) as unknown as TermAuctionBidLocker;

  const filteredBids: TermAuctionBidStruct[] = [];
  for (const bid of bids) {
    const lockedBid = await bidLocker.lockedBid(bid.id);
    if ((lockedBid?.id === bid.id) === keepLocked) {
      filteredBids.push(bid);
    }
  }

  return filteredBids;
}

export async function filterAlreadyLockedOffers(
  offerLockerAddress: string,
  offers: TermAuctionOfferStruct[],
  keepLocked = false,
) {
  const offerLocker = (await ethers.getContractAt(
    TermAuctionOfferLockerABI,
    offerLockerAddress,
  )) as unknown as TermAuctionOfferLocker;

  const filteredOffers: TermAuctionOfferStruct[] = [];
  for (const offer of offers) {
    const lockedOffer = await offerLocker.lockedOffer(offer.id);
    if ((lockedOffer?.id === offer.id) === keepLocked) {
      filteredOffers.push(offer);
    }
  }

  return filteredOffers;
}

export async function lockBids(
  bidLockerAddress: string,
  bids: TermAuctionBidSubmissionStruct[],
  signers: { [address: string]: Signer },
  signer?: Signer,
) {
  const sharedBidLocker = signer
    ? ((await ethers.getContractAt(
        TermAuctionBidLockerABI,
        bidLockerAddress,
        signer,
      )) as unknown as TermAuctionBidLocker)
    : undefined;

  const bidGroups: { [bidder: string]: TermAuctionBidSubmissionStruct[] } = {};
  for (const bid of bids) {
    if (!bidGroups[bid.bidder.toString()]) {
      bidGroups[bid.bidder.toString()] = [];
    }
    bidGroups[bid.bidder.toString()].push(bid);
  }

  for (const [bidder, bids] of Object.entries(bidGroups)) {
    console.log(`Locking bids: ${JSON.stringify(bids, null, 2)}`);
    if (!signers[bidder]) {
      console.error(`No signer for bidder: ${bidder}. Skipping...`);
      continue;
    }
    const termAuctionBidLocker =
      sharedBidLocker ??
      ((await ethers.getContractAt(
        TermAuctionBidLockerABI,
        bidLockerAddress,
        signers[bidder],
      )) as unknown as TermAuctionBidLocker);

    await termAuctionBidLocker.connect(signers[bidder]).lockBids(bids);
    console.log(`Locked bids: ${bids.map((bid) => bid.id)}`);
  }
}

export async function lockOffers(
  offerLockerAddress: string,
  offers: TermAuctionOfferSubmissionStruct[],
  signers: { [address: string]: Signer },
  signer?: Signer,
) {
  const sharedOfferLocker = signer
    ? ((await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        offerLockerAddress,
        signer,
      )) as unknown as TermAuctionOfferLocker)
    : undefined;

  const offerGroups: { [offeror: string]: TermAuctionOfferSubmissionStruct[] } =
    {};
  for (const offer of offers) {
    if (!offerGroups[offer.offeror.toString()]) {
      offerGroups[offer.offeror.toString()] = [];
    }
    offerGroups[offer.offeror.toString()].push(offer);
  }

  for (const [offeror, offers] of Object.entries(offerGroups)) {
    console.log(`Locking offers: ${JSON.stringify(offers, null, 2)}`);
    if (!signers[offeror]) {
      console.error(`No signer for offeror: ${offeror}. Skipping...`);
      continue;
    }

    const termAuctionOfferLocker =
      sharedOfferLocker ??
      ((await ethers.getContractAt(
        TermAuctionOfferLockerABI,
        offerLockerAddress,
        signers[offeror],
      )) as unknown as TermAuctionOfferLocker);

    console.log(`Locking offers: ${JSON.stringify(offers, null, 2)}`);
    await termAuctionOfferLocker.connect(signers[offeror]).lockOffers(offers);
    console.log(`Locked offers: ${offers.map((offer) => offer.id)}`);
  }
}

export async function revealBids(
  bidLockerAddress: string,
  bids: TermAuctionBidStruct[],
  signers: { [address: string]: Signer },
) {
  const termAuctionBidLocker = (await ethers.getContractAt(
    TermAuctionBidLockerABI,
    bidLockerAddress,
  )) as unknown as TermAuctionBidLocker;

  const ids = await Promise.all(
    bids.map((bid) =>
      getGeneratedTenderId(
        bid.id.toString() || "",
        termAuctionBidLocker,
        signers[bid.bidder.toString()],
      ),
    ),
  );
  const prices = bids.map((bid) => bid.bidPriceRevealed);
  const nonces = Array(bids.length).fill("12345");
  console.log(
    `Revealing bids: ${JSON.stringify([ids, prices, nonces], null, 2)}`,
  );
  await termAuctionBidLocker.revealBids(ids, prices, nonces);
  console.log(`Revealed bids: ${JSON.stringify(ids, null, 2)}`);

  return ids;
}

export async function revealOffers(
  offerLockerAddress: string,
  offers: TermAuctionOfferStruct[],
  signers: { [address: string]: Signer },
) {
  const termAuctionOfferLocker = (await ethers.getContractAt(
    TermAuctionOfferLockerABI,
    offerLockerAddress,
  )) as unknown as TermAuctionOfferLocker;

  const ids = await Promise.all(
    offers.map((offer) =>
      getGeneratedTenderId(
        offer.id.toString() || "",
        termAuctionOfferLocker,
        signers[offer.offeror.toString()],
      ),
    ),
  );
  const prices = offers.map((offer) => offer.offerPriceRevealed);
  const nonces = Array(offers.length).fill("678910");
  console.log(
    `Revealing offers: ${JSON.stringify([ids, prices, nonces], null, 2)}`,
  );
  await termAuctionOfferLocker.revealOffers(ids, prices, nonces);
  console.log(`Revealed offers: ${JSON.stringify(ids, null, 2)}`);

  return ids;
}

export async function completeAuctionInputFromTSV(
  tsv: string,
  purchaseTokenAddress: string,
  collateralTokenAddress: string,
) {
  const { bids, offers } = await parseBidsOffers(
    tsv,
    purchaseTokenAddress,
    collateralTokenAddress,
  );

  return {
    expiredRolloverBids: [],
    // We assume that all bids/offers were revealed at this point.
    revealedBidSubmissions: bids.map((bid) => bid.id),
    revealedOfferSubmissions: offers.map((offer) => offer.id),
    unrevealedBidSubmissions: [],
    unrevealedOfferSubmissions: [],
  } as CompleteAuctionInputStruct;
}
