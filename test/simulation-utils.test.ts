/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  TermAuction,
  TermController,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
  TestPriceFeed,
  TestToken,
} from "../typechain-types";
import { BigNumber, BigNumberish, Signer, Wallet } from "ethers";
import dayjs from "dayjs";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { NonceManager } from "@ethersproject/experimental";
import TermAuctionABI from "../abi/TermAuction.json";
import TestTokenABI from "../abi/TestToken.json";
import {
  parseBidsOffers,
  getBytesHash,
  lockBids,
  revealBids,
  lockOffers,
  revealOffers,
  getGeneratedTenderId,
} from "../utils/simulation-utils";

const clearingPriceTestCSV_random1 = `1	235610440000	4.9	1	269816180000	3.3
2	323003960000	6	2	380489230000	7.4
3	188737020000	3.5	3	251448030000	2.6
4	481792720000	4.2	4	88591690000	6.3
`;

function expectBigNumberEq(
  actual: BigNumber,
  expected: BigNumberish,
  message: string = `Expected ${expected.toString()} but was ${actual.toString()}`
): void {
  // eslint-disable-next-line no-unused-expressions
  expect(actual.eq(expected), message).to.be.true;
}

describe("simulation-utils", () => {
  let wallets: SignerWithAddress[];
  let termController: FakeContract<TermController>;
  let testCollateralToken: TestToken;
  let testPurchaseToken: TestToken;
  let mockCollateralFeed: TestPriceFeed;
  let mockPurchaseFeed: TestPriceFeed;
  let maturityPeriod: MaturityPeriodInfo;
  let auctionIdHash: string;
  let snapshotId: string;
  let termEventEmitter: TermEventEmitter;
  let termInitializer: TermInitializer;
  let termOracle: TermPriceConsumerV3;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);

    wallets = await ethers.getSigners();

    const purchaseTokenDecimals = 8;
    const collateralTokenDecimals = 8;
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.deployed();
    await testCollateralToken.initialize(
      "Collateral Token",
      "CT",
      collateralTokenDecimals,
      [],
      []
    );
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.deployed();
    await testPurchaseToken.initialize(
      "Purchase Token",
      "PT",
      purchaseTokenDecimals,
      [],
      []
    );

    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3"
    );
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [wallets[4].address, wallets[5].address],
      {
        kind: "uups",
      }
    )) as TermPriceConsumerV3;

    termController = await smock.fake<TermController>("TermController");
    termController.isTermDeployed.returns(true);

    const termInitializerFactory = await ethers.getContractFactory(
      "TermInitializer"
    );
    termInitializer = await termInitializerFactory.deploy(
      wallets[7].address,
      wallets[3].address
    );
    await termInitializer.deployed();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[4].address, wallets[5].address, termInitializer.address],
      { kind: "uups" }
    )) as TermEventEmitter;

    const mockPriceFeedFactory = await ethers.getContractFactory(
      "TestPriceFeed"
    );
    mockCollateralFeed = await mockPriceFeedFactory.deploy(
      collateralTokenDecimals,
      "",
      1,
      1,
      1e10,
      1,
      1,
      1
    );
    mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      purchaseTokenDecimals,
      "",
      1,
      1,
      1e8,
      1,
      1,
      1
    );

    await termOracle
      .connect(wallets[5])
      .addNewTokenPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed.address
      );
    await termOracle
      .connect(wallets[5])
      .addNewTokenPriceFeed(
        testPurchaseToken.address,
        mockPurchaseFeed.address
      );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore.timestamp;
    const currentTimestamp = dayjs.unix(timestampBefore);
    const auctionStart = currentTimestamp.subtract(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    maturityPeriod = await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
        termOracleAddress: termOracle.address,
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        servicerMaturityTimestamp: maturity.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asSeconds().toString(),
        redemptionBuffer: redemptionBuffer.asSeconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: testPurchaseToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
      },
      "uups"
    );
    auctionIdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [maturityPeriod.termAuctionId]
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("completeAuction completes an auction - random1", async () => {
    const treasury = Wallet.createRandom();
    termController.getTreasuryAddress.returns(treasury.address);

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      testPurchaseToken.address,
      testCollateralToken.address,
      wallets
    );

    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        TestTokenABI,
        testCollateralToken.address,
        managedWallet
      )) as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        TestTokenABI,
        testPurchaseToken.address,
        managedWallet
      )) as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod.termRepoLocker.address,
        "1" + "0".repeat(25)
      );
      await tx.wait();
    }

    await lockBids(
      maturityPeriod.termAuctionBidLocker.address,
      bids,
      walletsByAddress
    );
    await lockOffers(
      maturityPeriod.termAuctionOfferLocker.address,
      offers,
      walletsByAddress
    );

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const revealedBids = await revealBids(
      maturityPeriod.termAuctionBidLocker.address,
      bids,
      walletsByAddress
    );
    const revealedOffers = await revealOffers(
      maturityPeriod.termAuctionOfferLocker.address,
      offers,
      walletsByAddress
    );

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      TermAuctionABI,
      maturityPeriod.auction.address,
      wallet
    )) as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      })
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-2"),
          maturityPeriod.termAuctionBidLocker,
          walletsByAddress[bids[3].bidder.toString()]
        ),
        anyValue
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-4"),
          maturityPeriod.termAuctionBidLocker,
          walletsByAddress[bids[2].bidder.toString()]
        ),
        anyValue
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-offer-3"),
          maturityPeriod.termAuctionOfferLocker,
          walletsByAddress[offers[0].offeror.toString()]
        ),
        anyValue
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdHash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "545000000000000000"
      );

    const clearingPrice = await auction.clearingPrice();
    expectBigNumberEq(clearingPrice, "545000000000000000");
  });
});
/* eslint-enable camelcase */
