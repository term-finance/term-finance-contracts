/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  TermAuction,
  TermController,
  TermController__factory,
  TermDiamond,
  TermDiamondFactory,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
  TestPriceFeed,
  TestToken,
} from "../typechain-types";
import {
  BigNumberish,
  NonceManager,
  Signer,
  Wallet,
  solidityPackedKeccak256,
} from "ethers";
import dayjs from "dayjs";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  deployMaturityPeriod,
  MaturityPeriodInfo,
} from "../utils/deploy-utils";
import {
  parseBidsOffers,
  getBytesHash,
  lockBids,
  revealBids,
  lockOffers,
  revealOffers,
  getGeneratedTenderId,
} from "../utils/simulation-utils";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";

const clearingPriceTestCSV_random1 = `1	235610440000	4.9	1	269816180000	3.3
2	323003960000	6	2	380489230000	7.4
3	188737020000	3.5	3	251448030000	2.6
4	481792720000	4.2	4	88591690000	6.3
`;

function expectBigNumberEq(
  actual: bigint,
  expected: BigNumberish,
  message: string = `Expected ${expected.toString()} but was ${actual.toString()}`,
): void {
  // eslint-disable-next-line no-unused-expressions
  expect(actual === BigInt(expected), message).to.be.true;
}

describe("simulation-utils", () => {
  let wallets: SignerWithAddress[];
  let termController: MockContract<TermController>;
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
  let termDiamond: TermDiamond;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot", []);

    wallets = await ethers.getSigners();

    const purchaseTokenDecimals = 8;
    const collateralTokenDecimals = 8;
    const testTokenFactory = await ethers.getContractFactory("TestToken");
    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.waitForDeployment();
    await testCollateralToken.initialize(
      "Collateral Token",
      "CT",
      collateralTokenDecimals,
      [],
      [],
    );
    testPurchaseToken = await testTokenFactory.deploy();
    await testPurchaseToken.waitForDeployment();
    await testPurchaseToken.initialize(
      "Purchase Token",
      "PT",
      purchaseTokenDecimals,
      [],
      [],
    );

    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3",
    );
    termOracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [wallets[4].address],
      {
        kind: "uups",
      },
    )) as unknown as TermPriceConsumerV3;

    termController = await deployMock<TermController>(
      TermController__factory.abi,
      wallets[0],
    );
    const termControllerInterface = TermController__factory.createInterface();
    await termController.setup(
      {
        abi: termControllerInterface.getFunction("markTermDeployed"),
        outputs: [],
        kind: "read",
      },
      {
        abi: termControllerInterface.getFunction("isTermDeployed"),
        outputs: [true],
        kind: "read",
      },
      {
        abi: termControllerInterface.getFunction("termContractsPaused"),
        outputs: [false],
        kind: "read",
      },
      {
        abi: termControllerInterface.getFunction("registeredRepoIds"),
        outputs: [false],
        kind: "read",
      },
      {
        abi: termControllerInterface.getFunction("pairAuction"),
        kind: "write",
      },
      {
        abi: termControllerInterface.getFunction("recordAuctionResult"),
        kind: "write",
      },
      {
        abi: termControllerInterface.getFunction("registerRepoId"),
        kind: "write",
      },
      {
        abi: termControllerInterface.getFunction("registeredAuctionIds"),
        outputs: [false],
        kind: "read",
      },
      {
        abi: termControllerInterface.getFunction("registerAuctionId"),
        kind: "write",
      }

    );

    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      wallets[7].address,
      wallets[3].address,
    );
    termInitializer = await termInitializer.waitForDeployment();

    // Deploy TermDiamond via factory
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = (await termDiamondFactoryFactory.deploy(
      wallets[6].address,
      wallets[4].address,
    )) as unknown as TermDiamondFactory;
    await termDiamondFactory.waitForDeployment();

    const termDiamondTx = await termDiamondFactory.deployDiamond();
    const termDiamondReceipt = await termDiamondTx.wait();
    const diamondDeployedEvent = termDiamondReceipt?.logs.find(
      (log) =>
        log.topics[0] ===
        termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash,
    );
    if (!diamondDeployedEvent)
      throw new Error("DiamondDeployed event not found");
    const decodedEvent =
      termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    termDiamond = (await ethers.getContractAt(
      "TermDiamond",
      decodedEvent!.args.diamond,
    )) as unknown as TermDiamond;

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        wallets[4].address,
        wallets[5].address,
        await termInitializer.getAddress(),
        wallets[5].address,
        await termDiamond.getAddress(),
      ],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    mockCollateralFeed = await mockPriceFeedFactory.deploy(
      collateralTokenDecimals,
      "",
      1,
      1,
      1e10,
      1,
      1,
      1,
    );
    mockPurchaseFeed = await mockPriceFeedFactory.deploy(
      purchaseTokenDecimals,
      "",
      1,
      1,
      1e8,
      1,
      1,
      1,
    );

    console.log("======= Adding price feeds =======");

    await termOracle
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        testCollateralToken.getAddress(),
        mockCollateralFeed.getAddress(),
        0,
      );
    await termOracle
      .connect(wallets[4])
      .addNewTokenPriceFeed(
        testPurchaseToken.getAddress(),
        mockPurchaseFeed.getAddress(),
        0,
      );

    console.log("======= Price feeds added =======");

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp;
    if (!timestampBefore) {
      throw new Error("No timestamp found");
    }
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
        termControllerAddress: await termController.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        termOracleAddress: await termOracle.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
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
        purchaseTokenAddress: await testPurchaseToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: wallets[7],
        devopsMultisig: wallets[4].address,
        adminWallet: wallets[6].address,
        controllerAdmin: wallets[5],
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );
    auctionIdHash = solidityPackedKeccak256(
      ["string"],
      [maturityPeriod.termAuctionId],
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("completeAuction completes an auction - random1", async () => {
    const treasury = Wallet.createRandom();

    const termControllerInterface = TermController__factory.createInterface();
    await termController.setup({
      abi: termControllerInterface.getFunction("getTreasuryAddress"),
      inputs: [],
      outputs: [treasury.address],
      kind: "read",
    });

    const { bids, offers } = await parseBidsOffers(
      clearingPriceTestCSV_random1,
      await testPurchaseToken.getAddress(),
      await testCollateralToken.getAddress(),
      wallets,
    );

    const walletsByAddress = {} as { [address: string]: Signer };
    for (const wallet of wallets) {
      const managedWallet = new NonceManager(wallet as any);
      walletsByAddress[wallet.address] = managedWallet;
      const collateralToken = (await ethers.getContractAt(
        "TestToken",
        await testCollateralToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      const purchaseToken = (await ethers.getContractAt(
        "TestToken",
        await testPurchaseToken.getAddress(),
        managedWallet,
      )) as unknown as TestToken;
      let tx = await collateralToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await collateralToken.approve(
        maturityPeriod.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
      tx = await purchaseToken.mint(wallet.address, "1" + "0".repeat(25));
      await tx.wait();
      tx = await purchaseToken.approve(
        maturityPeriod.termRepoLocker.getAddress(),
        "1" + "0".repeat(25),
      );
      await tx.wait();
    }

    await lockBids(
      await maturityPeriod.termAuctionBidLocker.getAddress(),
      bids,
      walletsByAddress,
    );
    await lockOffers(
      await maturityPeriod.termAuctionOfferLocker.getAddress(),
      offers,
      walletsByAddress,
    );

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const revealedBids = await revealBids(
      await maturityPeriod.termAuctionBidLocker.getAddress(),
      bids,
      walletsByAddress,
    );
    const revealedOffers = await revealOffers(
      await maturityPeriod.termAuctionOfferLocker.getAddress(),
      offers,
      walletsByAddress,
    );

    await network.provider.send("evm_increaseTime", [
      dayjs.duration({ days: 1 }).asSeconds(),
    ]);

    const wallet = new NonceManager(wallets[0] as any);
    const auction = (await ethers.getContractAt(
      "TermAuction",
      await maturityPeriod.auction.getAddress(),
      wallet,
    )) as unknown as TermAuction;
    await expect(
      auction.completeAuction({
        revealedBidSubmissions: revealedBids,
        expiredRolloverBids: [],
        unrevealedBidSubmissions: [],
        revealedOfferSubmissions: revealedOffers,
        unrevealedOfferSubmissions: [],
      }),
    )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-2"),
          maturityPeriod.termAuctionBidLocker,
          walletsByAddress[bids[3].bidder.toString()],
        ),
        anyValue,
      )
      .to.emit(termEventEmitter, "BidAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-bid-4"),
          maturityPeriod.termAuctionBidLocker,
          walletsByAddress[bids[2].bidder.toString()],
        ),
        anyValue,
      )
      .to.emit(termEventEmitter, "OfferAssigned")
      .withArgs(
        auctionIdHash,
        await getGeneratedTenderId(
          getBytesHash("test-offer-3"),
          maturityPeriod.termAuctionOfferLocker,
          walletsByAddress[offers[0].offeror.toString()],
        ),
        anyValue,
      )
      .to.emit(termEventEmitter, "AuctionCompleted")
      .withArgs(
        auctionIdHash,
        anyValue,
        anyValue,
        anyValue,
        anyValue,
        "525000000000000000",
      );

    const clearingPrice = await auction.clearingPrice();
    expectBigNumberEq(clearingPrice, "525000000000000000");
  });
});
/* eslint-enable camelcase */
