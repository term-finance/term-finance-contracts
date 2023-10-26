/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { FakeContract, smock } from "@defi-wonderland/smock";
import {
  ERC20Upgradeable,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermRepoCollateralManager,
  TermEventEmitter,
  TermRepoServicer,
  TermPriceConsumerV3,
  TestingTermAuction,
  TermRepoRolloverManager,
} from "../typechain-types";
import { BigNumber, BigNumberish } from "ethers";
import dayjs from "dayjs";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { getBytesHash, parseBidsOffers } from "../utils/simulation-utils";
import {
  TermAuctionBidStruct,
  TermAuctionRevealedBidStruct,
} from "../typechain-types/contracts/TermAuctionBidLocker";
import {
  TermAuctionOfferStruct,
  TermAuctionRevealedOfferStruct,
} from "../typechain-types/contracts/TermAuctionOfferLocker";

let termIdString: string;

let auctionIdString: string;
let auctionIdHash: string;

const clearingPriceTestCSV_noClear = `1	23561044	2	1	26981618	1
`;

const clearingPriceTestCSV_random2 = `1	1234500000000	.023	1	222222200000000	.011
2	12900000000000	.02			
3	1234500000000	.023			
`;

const clearingPriceTestCSV_random1 = `1	23561044	4.9	1	26981618	3.3
2	32300396	6	2	38048923	7.4
3	18873702	3.5	3	25144803	2.6
4	48179272	4.2	4	8859169	6.3
5	7846583	10	5	46032381	6.2
6	27506617	7.9	6	49203975	8
7	29076862	3.6	7	2137487	9.8
8	44710209	5.8	8	16506581	2.8
9	3946986	3.2			
10	27783771	9.9			
11	1075872	4.8			
12	8586601	8.4			
13	8885873	3.5			
14	41895530	2.6			
15	34032250	3.4			
16	33714348	7.1			
17	37524274	7			
`;

const clearingPriceTestCSV_elasticsupply = `1	30835715	9.8	1	187840454	3.6
2	3903018	8.4	2	172422597	3.6
3	36002252	3.8	3	170471088	3.6
4	31945669	6.2	4	152469962	3.6
5	11807375	9.1			
6	30635960	4.6			
7	5768278	8.7			
8	5860025	4.6			
9	15125088	9.7			
10	6994836	9.9			
11	24386910	3.2			
12	45587859	6.5			
13	11969261	5.1			
14	22287154	3.3			
15	39779295	2.9			
16	48834980	6.5			
17	3957234	4.5			
`;

const clearingPriceTestCSV_elasticdemand = `1	223336850	5.8	1	13293026	7.7
2	216690337	5.8	2	30314332	9
3	201533171	5.8	3	31499113	9.7
4	185783615	5.8	4	18738656	6.7
			5	47821629	10
			6	44237827	4.7
			7	13976350	9.3
			8	19744607	4.6
			9	38770638	4
			10	26852816	8.7
			11	24603902	5.5
			12	25072381	3.3
			13	10979616	7.6
			14	7710416	4.4
			15	31885039	5.9
			16	20548279	10
			17	40625074	9.2
`;

const clearingPriceTestCSV_inelasticsupply = `1	19680053	7.5	1	50311700	6.2
2	35816408	2.8	2	48343694	6.2
3	13646410	4	3	44762054	6.2
4	34953306	8.5	4	43397413	6.2
5	8231962	3.9			
6	21547905	7.1			
7	32182018	7			
8	15815162	4.4			
9	34759184	6.2			
10	23131182	2.9			
11	30816249	5.9			
12	48523943	4.8			
13	22278621	3.6			
14	44373314	4			
15	35829511	3.4			
16	40598634	8.5			
17	40933140	6			
`;

const clearingPriceTestCSV_inelasticdemand = `1	30158029	3	1	28278697	5.6
2	27330159	3	2	45680509	4.9
3	22762108	3	3	15580451	9.1
4	21204063	3	4	21083023	7.8
			5	16794736	6.2
			6	20395606	4.5
			7	2337785	3.3
			8	1862144	9.9
			9	13758227	3.7
			10	1358984	5.2
			11	6729582	2.6
			12	35211944	5.4
			13	8977069	5.6
			14	47844312	8.4
			15	1360089	2.7
			16	1592467	6.2
			17	32734670	8.5
`;

const clearingPriceTestCSV_rltest1 = `1	9000000000000	2.0	1	10000000000000	3.125
`;

function expectBigNumberEq(
  actual: BigNumber,
  expected: BigNumberish,
  message: string = `Expected ${expected.toString()} but was ${actual.toString()}`
): void {
  // eslint-disable-next-line no-unused-expressions
  expect(actual.eq(expected), message).to.be.true;
}

describe("TermAuction", () => {
  let wallets: SignerWithAddress[];
  let oracle: FakeContract<TermPriceConsumerV3>;
  let testCollateralToken: FakeContract<ERC20Upgradeable>;
  let testBorrowedToken: FakeContract<ERC20Upgradeable>;
  let termEventEmitter: TermEventEmitter;
  let termAuction: TestingTermAuction;
  let termRepoServicer: FakeContract<TermRepoServicer>;
  let termRepoCollateralManager: FakeContract<TermRepoCollateralManager>;
  let pastTermRepoServicer: FakeContract<TermRepoServicer>;
  let pastTermRepoCollateralManager: FakeContract<TermRepoCollateralManager>;
  let pastTermRepoRolloverManager: FakeContract<TermRepoRolloverManager>;
  let termAuctionBidLocker: FakeContract<TermAuctionBidLocker>;
  let termAuctionOfferLocker: FakeContract<TermAuctionOfferLocker>;
  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    wallets = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    oracle = await smock.fake<TermPriceConsumerV3>("TermPriceConsumerV3");
    await oracle.deployed();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[3].address, wallets[4].address, wallets[5].address],
      { kind: "uups" }
    )) as TermEventEmitter;

    termAuctionBidLocker = await smock.fake<TermAuctionBidLocker>(
      "TermAuctionBidLocker"
    );
    await termAuctionBidLocker.deployed();

    termAuctionOfferLocker = await smock.fake<TermAuctionOfferLocker>(
      "TermAuctionOfferLocker"
    );
    await termAuctionOfferLocker.deployed();

    termRepoServicer = await smock.fake<TermRepoServicer>("TermRepoServicer");
    await termRepoServicer.deployed();

    termRepoCollateralManager = await smock.fake<TermRepoCollateralManager>(
      "TermRepoCollateralManager"
    );
    await termRepoCollateralManager.deployed();

    pastTermRepoServicer = await smock.fake<TermRepoServicer>(
      "TermRepoServicer"
    );
    await pastTermRepoServicer.deployed();

    pastTermRepoCollateralManager = await smock.fake<TermRepoCollateralManager>(
      "TermRepoCollateralManager"
    );
    await pastTermRepoCollateralManager.deployed();

    pastTermRepoRolloverManager = await smock.fake<TermRepoRolloverManager>(
      "TermRepoRolloverManager"
    );
    await pastTermRepoRolloverManager.deployed();

    testCollateralToken = await smock.fake<ERC20Upgradeable>(
      "ERC20Upgradeable"
    );
    await testCollateralToken.deployed();
    testBorrowedToken = await smock.fake<ERC20Upgradeable>("ERC20Upgradeable");
    await testBorrowedToken.deployed();

    const termAuctionFactory = await ethers.getContractFactory(
      "TestingTermAuction"
    );

    const endAuction = dayjs().subtract(10, "minute");
    const maturityTimestamp = endAuction.add(360, "day");

    termIdString = maturityTimestamp.toString() + "_ft3_ft1-ft2";

    auctionIdString = endAuction.toString() + "_ft3_ft1-ft2";

    auctionIdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [auctionIdString]
    );

    termAuction = (await upgrades.deployProxy(
      termAuctionFactory,
      [
        termIdString,
        auctionIdString,
        endAuction.unix(),
        endAuction.unix(),
        maturityTimestamp.unix(),
        testBorrowedToken.address,
        wallets[5].address,
        1,
      ],
      {
        kind: "uups",
      }
    )) as TestingTermAuction;
    await termEventEmitter
      .connect(wallets[5])
      .pairTermContract(termAuction.address);
    await expect(
      termAuction
        .connect(wallets[1])
        .pairTermContracts(
          termEventEmitter.address,
          termRepoServicer.address,
          termAuctionBidLocker.address,
          termAuctionOfferLocker.address,
          wallets[4].address,
          wallets[6].address,
          "0.1.0"
        )
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`
    );
    await termAuction
      .connect(wallets[5])
      .pairTermContracts(
        termEventEmitter.address,
        termRepoServicer.address,
        termAuctionBidLocker.address,
        termAuctionOfferLocker.address,
        wallets[4].address,
        wallets[6].address,
        "0.1.0"
      );
    await expect(
      termAuction
        .connect(wallets[5])
        .pairTermContracts(
          termEventEmitter.address,
          termRepoServicer.address,
          termAuctionBidLocker.address,
          termAuctionOfferLocker.address,
          wallets[4].address,
          wallets[6].address,
          "0.1.0"
        )
    ).to.be.revertedWithCustomError(termAuction, "AlreadyTermContractPaired");
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - random 1", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "495000000000000000");
    expectBigNumberEq(totalAllocated, "144281935");
  });

  it("calculateClearingPrice reverts if clearing offset is not 0 or 1", async () => {
    await expect(termAuction.calculateClearingPrice([], [], "2")).to.be
      .reverted;
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - elastic supply", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_elasticsupply,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "340000000000000000");
    expectBigNumberEq(totalAllocated, "86453359");
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - elastic demand", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_elasticdemand,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "625000000000000000");
    expectBigNumberEq(totalAllocated, "254648891");
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - inelastic supply", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_inelasticsupply,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "510000000000000000"); // 5.1%
    expectBigNumberEq(totalAllocated, "186814861");
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - inelastic demand", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_inelasticdemand,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "570000000000000000"); // 5.75%
    expectBigNumberEq(totalAllocated, "101454359");
  });

  it("calculateClearingPrice gets the price which meets a maximum amount of provided offers/bids - rl test 1", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_rltest1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    const [clearingPrice, totalAllocated] =
      await termAuction.calculateClearingPrice(
        revealedBids,
        revealedOffers,
        "1"
      );

    expectBigNumberEq(clearingPrice, "256250000000000000"); // 2.5625%
    expectBigNumberEq(totalAllocated, "9000000000000");
  });

  // Complete Auction tests ===================================================

  it("completeAuction results in cancellation due to no revealed bids", async () => {
    const { bids } = await parseBidsOffers(
      clearingPriceTestCSV_noClear,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([
      [revealedBids[0]],
      [revealedBids[0]],
    ]);
    termAuctionOfferLocker.getAllOffers.returns([[], []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdHash, false, false);
  });

  it("completeAuction results in cancellation due to no revealed offers", async () => {
    const { offers } = await parseBidsOffers(
      clearingPriceTestCSV_noClear,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([[], []]);
    termAuctionOfferLocker.getAllOffers.returns([
      [revealedOffers[0]],
      [revealedOffers[0]],
    ]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdHash, false, false);
  });

  it("completeAuction completes an auction - random 1", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    revealedBids[0].isRollover = true;
    revealedBids[0].rolloverPairOffTermRepoServicer =
      pastTermRepoServicer.address;

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termRepoServicer.openExposureOnRolloverNew.returns();
    termRepoServicer.termRepoCollateralManager.returns(
      termRepoCollateralManager.address
    );
    pastTermRepoServicer.closeExposureOnRolloverExisting.returns();
    pastTermRepoServicer.termRepoCollateralManager.returns(
      pastTermRepoCollateralManager.address
    );
    pastTermRepoServicer.termRepoRolloverManager.returns(
      pastTermRepoRolloverManager.address
    );
    pastTermRepoRolloverManager.fulfillRollover.returns();
    pastTermRepoCollateralManager.transferRolloverCollateral.returns();
    termRepoCollateralManager.acceptRolloverCollateral.returns();
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();

    // don't allow auction to be cleared if there are unrevealed tenders if caller is not admin
    await expect(
      termAuction.connect(wallets[1]).completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [bids[0].id],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.be.revertedWithCustomError(termAuction, `InvalidParameters`)
      .withArgs(
        "All tender prices must be revealed for auction to be complete"
      );

    await expect(
      termAuction.connect(wallets[1]).completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [offers[0].id],
      })
    )
      .to.be.revertedWithCustomError(termAuction, `InvalidParameters`)
      .withArgs(
        "All tender prices must be revealed for auction to be complete"
      );

    await termAuction.completeAuction({
      revealedBidSubmissions: [],
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [],
      unrevealedOfferSubmissions: [],
    });

    const clearingPrice = await termAuction.clearingPrice();
    expectBigNumberEq(clearingPrice, "495000000000000000");

    const repurchasePrice = await termAuction.calculateRepurchasePrice(1000);
    expect(repurchasePrice).to.eq("1495");
  });

  it("completeAuction completes an auction - random 2", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random2,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    revealedBids[0].isRollover = true;
    revealedBids[0].rolloverPairOffTermRepoServicer =
      pastTermRepoServicer.address;

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termRepoServicer.openExposureOnRolloverNew.returns();
    termRepoServicer.termRepoCollateralManager.returns(
      termRepoCollateralManager.address
    );
    pastTermRepoServicer.closeExposureOnRolloverExisting.returns();
    pastTermRepoServicer.termRepoCollateralManager.returns(
      pastTermRepoCollateralManager.address
    );
    pastTermRepoServicer.termRepoRolloverManager.returns(
      pastTermRepoRolloverManager.address
    );
    pastTermRepoRolloverManager.fulfillRollover.returns();
    pastTermRepoCollateralManager.transferRolloverCollateral.returns();
    termRepoCollateralManager.acceptRolloverCollateral.returns();
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();

    // don't allow auction to be cleared if there are unrevealed tenders if caller is not admin
    await expect(
      termAuction.connect(wallets[1]).completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [bids[0].id],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.be.revertedWithCustomError(termAuction, `InvalidParameters`)
      .withArgs(
        "All tender prices must be revealed for auction to be complete"
      );

    await expect(
      termAuction.connect(wallets[1]).completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [offers[0].id],
      })
    )
      .to.be.revertedWithCustomError(termAuction, `InvalidParameters`)
      .withArgs(
        "All tender prices must be revealed for auction to be complete"
      );

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdHash, true, false);

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "0");
  });

  it("completeAuction completes an auction - elastic supply", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_elasticsupply,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-4"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-3"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-2"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-1"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-15"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-11"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-14"), anyValue)
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdHash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "340000000000000000"
      );

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "340000000000000000");
    const repurchasePrice = await termAuction.calculateRepurchasePrice(1000);
    console.log(repurchasePrice);
    expect(repurchasePrice).to.eq(1340);
  });

  it("completeAuction completes an auction - elastic demand", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_elasticdemand,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-16"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-5"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-3"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-7"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-17"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-2"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-10"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-1"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-13"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-4"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-1"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-2"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-3"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-4"), anyValue)
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdHash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "625000000000000000"
      );

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "625000000000000000");
    const repurchasePrice = await termAuction.calculateRepurchasePrice(1000);
    expect(repurchasePrice).to.eq(1625);
  });

  it("completeAuction completes an auction - inelastic supply", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_inelasticsupply,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-4"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-3"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-2"), anyValue)
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-bid-1"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-2"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-10"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-15"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-13"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-5"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-3"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-14"), anyValue)
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(auctionIdHash, getBytesHash("test-offer-8"), anyValue)
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdHash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "510000000000000000"
      );

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "510000000000000000");
    const repurchasePrice = await termAuction.calculateRepurchasePrice(1000);
    expect(repurchasePrice).to.eq(1510);
  });

  it("completeAuction cancels an auction - no clear", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_noClear,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdHash, true, false);
  });

  it("cancelAuction cancels an auction", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([
      revealedBids,
      [
        {
          id: bids[0].id,
          bidder: bids[0].bidder,
          bidPriceHash: bids[0].bidPriceHash,
          bidPriceRevealed: "0",
          amount: bids[0].amount,
          collateralAmounts: bids[0].collateralAmounts,
          purchaseToken: bids[0].purchaseToken,
          collateralTokens: bids[0].collateralTokens,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
          isRevealed: false,
        },
      ] as TermAuctionBidStruct[],
    ]);
    termAuctionOfferLocker.getAllOffers.returns([
      revealedOffers,
      [
        {
          id: offers[0].id,
          amount: offers[0].amount,
          offeror: offers[0].offeror,
          offerPriceHash: offers[0].offerPriceHash,
          offerPriceRevealed: "0",
          purchaseToken: offers[0].purchaseToken,
          isRevealed: false,
        },
      ] as TermAuctionOfferStruct[],
    ]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.connect(wallets[6]).cancelAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "AuctionCancelled")
      .withArgs(auctionIdHash, false, false);

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "0");
  });
  it("completeAuction reverts if it has already been completed", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await termAuction.completeAuction({
      revealedBidSubmissions: [],
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [],
      unrevealedOfferSubmissions: [],
    });

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    ).to.be.revertedWithCustomError(termAuction, "AuctionAlreadyCompleted");
  });
  it("completeAuction reverts if the auction is not closed", async () => {
    await termAuction.setEndTime(dayjs().add(1, "minute").unix());

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    ).to.be.revertedWithCustomError(termAuction, "AuctionNotClosed");
  });
  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await expect(termAuction.connect(wallets[4]).upgrade(wallets[0].address))
      .to.emit(termEventEmitter, "TermContractUpgraded")
      .withArgs(termAuction.address, wallets[0].address);

    await expect(
      termAuction.connect(wallets[1]).upgrade(wallets[0].address)
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
    );
  });
  it("can pause and unpause completeAuction", async () => {
    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testBorrowedToken.address,
      testCollateralToken.address,
      wallets
    );

    const revealedBids: TermAuctionRevealedBidStruct[] = [];
    for (const bid of bids) {
      if (bid.bidPriceRevealed) {
        revealedBids.push({
          ...bid,
          bidPriceRevealed: bid.bidPriceRevealed,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
        });
      }
    }

    const revealedOffers: TermAuctionRevealedOfferStruct[] = [];
    for (const offer of offers) {
      if (offer.offerPriceRevealed) {
        revealedOffers.push({
          ...offer,
          offerPriceRevealed: offer.offerPriceRevealed,
        });
      }
    }

    termAuctionBidLocker.getAllBids.returns([revealedBids, []]);
    termAuctionOfferLocker.getAllOffers.returns([revealedOffers, []]);
    termRepoServicer.fulfillBid.returns();
    termRepoServicer.fulfillOffer.returns();
    termRepoServicer.isTermRepoBalanced.returns(true);
    termAuctionBidLocker.auctionUnlockBid.returns();
    termAuctionOfferLocker.unlockOfferPartial.returns();
    testBorrowedToken.decimals.returns(8);

    await expect(
      termAuction.connect(wallets[6]).pauseCompleteAuction()
    ).to.emit(termEventEmitter, "CompleteAuctionPaused");

    await expect(
      termAuction.completeAuction({
        revealedBidSubmissions: [],
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: [],
        unrevealedOfferSubmissions: [],
      })
    ).to.be.revertedWithCustomError(termAuction, "CompleteAuctionPaused");

    await expect(
      termAuction.connect(wallets[6]).unpauseCompleteAuction()
    ).to.emit(termEventEmitter, "CompleteAuctionUnpaused");

    await termAuction.completeAuction({
      revealedBidSubmissions: [],
      expiredRolloverBids: [],
      unrevealedBidSubmissions: [],
      revealedOfferSubmissions: [],
      unrevealedOfferSubmissions: [],
    });

    const clearingPrice = await termAuction.clearingPrice();

    expectBigNumberEq(clearingPrice, "495000000000000000");

    const repurchasePrice = await termAuction.calculateRepurchasePrice(1000);
    expect(repurchasePrice).to.eq(1495);
  });
  it("version returns the current contract version", async () => {
    expect(await termAuction.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
