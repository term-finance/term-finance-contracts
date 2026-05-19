/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import dayjs from "dayjs";
import {
  MaxUint256,
  ZeroAddress,
  ZeroHash,
  parseEther,
  solidityPackedKeccak256,
} from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { getBytesHash } from "../utils/simulation-utils";
import {
  ITermController,
  TermController__factory,
  ITermRepoRolloverManager,
  TermRepoRolloverManager,
  TermEventEmitter,
  TestTermRepoServicer,
  TestToken,
  TestTermRepoLocker,
  TestTermRepoCollateralManager,
  TermPriceConsumerV3,
  TermController,
  TermRepoRolloverManager__factory,
  TermRepoToken,
} from "../typechain-types";
import {
  MockContract,
  deployMockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";
describe("TermManager Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let treasuryWallet: SignerWithAddress;
  let reserveAddress: SignerWithAddress;
  let anotherAuction: SignerWithAddress;
  let anotherAuctionBidLocker: SignerWithAddress;
  let anotherAuctionOfferLocker: SignerWithAddress;
  let termDiamond: SignerWithAddress;

  let termAuctionAddress: SignerWithAddress;
  let termAuctionBidLockerAddress: SignerWithAddress;
  let termAuctionOfferLockerAddress: SignerWithAddress;

  let termController: MockContract<ITermController>;
  let termEventEmitter: TermEventEmitter;
  let termRepoCollateralManager: TestTermRepoCollateralManager;
  let termRepoServicer: TestTermRepoServicer;
  let termRepoRolloverManager: MockContract<ITermRepoRolloverManager>;
  let termRepoLocker: TestTermRepoLocker;

  let fungibleToken1: TestToken;
  let fungibleToken2: TestToken;
  let fungibleToken3: TestToken;

  let testTermRepoToken: TermRepoToken;
  let testOracleConsumer: TermPriceConsumerV3;

  let termIdString: String;

  let termIdHashed: String;

  let snapshotId: any;
  let expectedVersion: string;

  let termStartTimestamp: any;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");

    upgrades.silenceWarnings();

    [
      wallet1,
      wallet2,
      wallet3,
      devopsMultisig,
      adminWallet,
      termInitializer,
      treasuryWallet,
      termAuctionAddress,
      termAuctionBidLockerAddress,
      termAuctionOfferLockerAddress,
      reserveAddress,
      anotherAuction,
      anotherAuctionBidLocker,
      anotherAuctionOfferLocker,
      termDiamond
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");

    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet3.address, termInitializer.address, wallet3.address, termDiamond.address],
      {
        kind: "uups",
      },
    )) as unknown as TermEventEmitter;

    const TermRepoCollateralManager = await ethers.getContractFactory(
      "TestTermRepoCollateralManager",
    );

    const TermRepoServicer = await ethers.getContractFactory(
      "TestTermRepoServicer",
    );

    const TermRepoLocker =
      await ethers.getContractFactory("TestTermRepoLocker");
    const TermRepoToken = await ethers.getContractFactory("TermRepoToken");

    const TestToken = await ethers.getContractFactory("TestToken");

    const TermPriceConsumerV3 = await ethers.getContractFactory(
      "TermPriceConsumerV3",
    );

    // Test ERC20Upgradable Tokens
    fungibleToken1 = (await upgrades.deployProxy(TestToken, [
      "TestToken1",
      "TT1",
      6,
      [wallet1.address, wallet2.address],
      ["250000000", "250000000"],
    ])) as unknown as TestToken;
    fungibleToken2 = (await upgrades.deployProxy(TestToken, [
      "TestToken2",
      "TT2",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "300000000", "300000000"],
    ])) as unknown as TestToken;
    fungibleToken3 = (await upgrades.deployProxy(TestToken, [
      "TestToken3",
      "TT3",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "50000000", "350000000"],
    ])) as unknown as TestToken;

    const mockPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    const fungibleToken1Feed = await mockPriceFeedFactory.deploy(
      3,
      "",
      1,
      1,
      2 * 1e3,
      1,
      1,
      1,
    );
    const fungibleToken2Feed = await mockPriceFeedFactory.deploy(
      3,
      "",
      1,
      1,
      1e3,
      1,
      1,
      1,
    );
    const fungibleToken3Feed = await mockPriceFeedFactory.deploy(
      3,
      "",
      1,
      1,
      1e3,
      1,
      1,
      1,
    );

    testOracleConsumer = (await upgrades.deployProxy(TermPriceConsumerV3, [
      devopsMultisig.address,
    ])) as unknown as TermPriceConsumerV3;

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await fungibleToken1.getAddress(),
        await fungibleToken1Feed.getAddress(),
        0,
      );

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await fungibleToken2.getAddress(),
        await fungibleToken2Feed.getAddress(),
        0,
      );

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(
        await fungibleToken3.getAddress(),
        await fungibleToken3Feed.getAddress(),
        0,
      );

    termController = await deployMockContract<TermController>(
      wallet1,
      TermController__factory.abi,
    );
    await termController.mock.getTreasuryAddress
      // .withArgs()
      .returns(treasuryWallet.address);
    await termController.mock.getProtocolReserveAddress
      // .withArgs()
      .returns(reserveAddress.address);
    await termController.mock.termContractsPaused.returns(false);


    termRepoRolloverManager = await deployMockContract<TermRepoRolloverManager>(
      wallet1,
      TermRepoRolloverManager__factory.abi,
    );
    await termRepoRolloverManager.mock.fulfillRollover.returns();


    // Yet to Mature Term Management

    termStartTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
    const maturationTimestampOneYear = termStartTimestamp + 60 * 60 * 24 * 365;

    termIdString = maturationTimestampOneYear.toString() + "_ft3_ft1-ft2";

    termIdHashed = solidityPackedKeccak256(["string"], [termIdString]);

    termRepoCollateralManager = (await upgrades.deployProxy(
      TermRepoCollateralManager,
      [
        termIdString,
        BigInt("200000000000000000"),
        BigInt("50000000000000000"),
        BigInt("5000000000000000"),
        await fungibleToken3.getAddress(),
        [
          {
            tokenAddress: await fungibleToken1.getAddress(),
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
          {
            tokenAddress: await fungibleToken2.getAddress(),
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
        ],
        await termEventEmitter.getAddress(),
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as unknown as TestTermRepoCollateralManager;
    termRepoServicer = (await upgrades.deployProxy(
      TermRepoServicer,
      [
        termIdString,
        maturationTimestampOneYear,
        60 * 60 * 8,
        60 * 15,
        BigInt("200000000000000000"),
        await fungibleToken3.getAddress(),
        await termController.getAddress(),
        await termEventEmitter.getAddress(),
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as unknown as TestTermRepoServicer;
    termRepoLocker = (await upgrades.deployProxy(
      TermRepoLocker,
      [termIdString, termInitializer.address],
      {
        kind: "uups",
      },
    )) as unknown as TestTermRepoLocker;
    testTermRepoToken = (await upgrades.deployProxy(
      TermRepoToken,
      [
        termIdString,
        "TermRepoToken_MMDDYY",
        "TT",
        6,
        "1000000000000000000",
        "1000000000000000000",
        termInitializer.address,
        {
          redemptionTimestamp: dayjs().unix(),
          purchaseToken: await fungibleToken3.getAddress(),
          termRepoServicer: await termRepoServicer.getAddress(),
          termRepoCollateralManager:
            await termRepoCollateralManager.getAddress(),
        },
      ],
      {
        kind: "uups",
      },
    )) as unknown as TermRepoToken;
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoLocker.getAddress());
    await expect(
      termRepoLocker
        .connect(wallet2)
        .pairTermContracts(
          await termRepoCollateralManager.getAddress(),
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoLocker,
      "AccessControlUnauthorizedAccount",
    );
    await termRepoLocker
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoCollateralManager.getAddress(),
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoCollateralManager.getAddress());
    await expect(
      termRepoCollateralManager
        .connect(wallet2)
        .pairTermContracts(
          await termRepoLocker.getAddress(),
          await termRepoServicer.getAddress(),
          termAuctionBidLockerAddress.address,
          termAuctionAddress.address,
          await termController.getAddress(),
          await testOracleConsumer.getAddress(),
          await termRepoRolloverManager.getAddress(),
          termDiamond.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );
    await termRepoCollateralManager
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoLocker.getAddress(),
        await termRepoServicer.getAddress(),
        termAuctionBidLockerAddress.address,
        termAuctionAddress.address,
        await termController.getAddress(),
        await testOracleConsumer.getAddress(),
        await termRepoRolloverManager.getAddress(),
        termDiamond.address,
        devopsMultisig.address,
        adminWallet.address,
      );

    await expect(
      termRepoCollateralManager
        .connect(termInitializer)
        .pairTermContracts(
          await termRepoLocker.getAddress(),
          await termRepoServicer.getAddress(),
          termAuctionBidLockerAddress.address,
          termAuctionAddress.address,
          await termController.getAddress(),
          await testOracleConsumer.getAddress(),
          await termRepoRolloverManager.getAddress(),
          termDiamond.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AlreadyTermContractPaired",
    );

    await expect(
      termRepoLocker
        .connect(termInitializer)
        .pairTermContracts(
          await termRepoCollateralManager.getAddress(),
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AlreadyTermContractPaired",
    );

    const collateralManagerInitializedFilter =
      termEventEmitter.filters.TermRepoCollateralManagerInitialized(
        undefined,
        undefined,
        undefined,
        undefined,
      );

    const termRepoCollateralManagerIntializedEvents =
      await termEventEmitter.queryFilter(collateralManagerInitializedFilter);

    expect(termRepoCollateralManagerIntializedEvents.length).to.equal(1);

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoServicer.getAddress());

    await expect(
      termRepoServicer
        .connect(wallet2)
        .pairTermContracts(
          await termRepoLocker.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await testTermRepoToken.getAddress(),
          termDiamond.address,
          termAuctionOfferLockerAddress.address,
          termAuctionAddress.address,
          await termRepoRolloverManager.getAddress(),
          devopsMultisig.address,
          wallet1.address,
          "0.1.0",
        ),
    ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AccessControlUnauthorizedAccount",
    );
    await termRepoServicer
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoLocker.getAddress(),
        await termRepoCollateralManager.getAddress(),
        await testTermRepoToken.getAddress(),
        termDiamond.address,
        termAuctionOfferLockerAddress.address,
        termAuctionAddress.address,
        await termRepoRolloverManager.getAddress(),
        devopsMultisig.address,
        wallet1.address,
        "0.1.0",
      );

    await expect(
      termRepoServicer
        .connect(termInitializer)
        .pairTermContracts(
          await termRepoLocker.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await testTermRepoToken.getAddress(),
          termDiamond.address,
          termAuctionOfferLockerAddress.address,
          termAuctionAddress.address,
          await termRepoRolloverManager.getAddress(),
          devopsMultisig.address,
          wallet1.address,
          "0.1.0",
        ),
    ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AlreadyTermContractPaired",
    );

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await testTermRepoToken.getAddress());

    await testTermRepoToken
      .connect(termInitializer)
      .pairTermContracts(
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );
    const servicerInitializedFilter =
      termEventEmitter.filters.TermRepoServicerInitialized(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

    const termRepoServicerIntializedEvents = await termEventEmitter.queryFilter(
      servicerInitializedFilter,
    );

    expect(termRepoServicerIntializedEvents.length).to.equal(1);

    // approve token transferring
    await fungibleToken1
      .connect(wallet1)
      .approve(await termRepoLocker.getAddress(), "250000000");
    await fungibleToken1
      .connect(wallet2)
      .approve(await termRepoLocker.getAddress(), "250000000");
    await fungibleToken2
      .connect(wallet1)
      .approve(await termRepoLocker.getAddress(), "300000000");
    await fungibleToken2
      .connect(wallet2)
      .approve(await termRepoLocker.getAddress(), "300000000");
    await fungibleToken2
      .connect(wallet3)
      .approve(await termRepoLocker.getAddress(), "300000000");
    await fungibleToken3
      .connect(wallet1)
      .approve(await termRepoLocker.getAddress(), "300000000");
    await fungibleToken3
      .connect(wallet2)
      .approve(await termRepoLocker.getAddress(), "300000000");
    await fungibleToken3
      .connect(wallet3)
      .approve(await termRepoLocker.getAddress(), "300000000");

    // Other mock setup:
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });
  describe("invalid initialization reverts", () => {
    it("collateral manager initialization reverts if purchase token is address zero", async () => {
      const TermRepoCollateralManager = await ethers.getContractFactory(
        "TestTermRepoCollateralManager",
      );

      await expect(
        upgrades.deployProxy(
          TermRepoCollateralManager,
          [
            termIdString,
            BigInt("200000000000000000"),
            BigInt("50000000000000000"),
            BigInt("5000000000000000"),
            ZeroAddress,
            [
              {
                tokenAddress: await fungibleToken1.getAddress(),
                initialCollateralRatio: "2000000000000000000",
                maintenanceRatio: "1500000000000000000",
                liquidatedDamage: "1",
              },
            ],
            await termEventEmitter.getAddress(),
            termInitializer.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("Zero address purchase token");
    });
    it("servicer initialization reverts if purchase token is address zero", async () => {
      const TermRepoServicer = await ethers.getContractFactory(
        "TestTermRepoServicer",
      );

      await expect(
        upgrades.deployProxy(
          TermRepoServicer,
          [
            termIdString,
            dayjs().unix().toString(),
            60 * 60 * 8,
            60 * 15,
            BigInt("200000000000000000"),
            ZeroAddress,
            await termController.getAddress(),
            await termEventEmitter.getAddress(),
            termInitializer.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("Zero address purchase token");
    });
    it("collateral manager initialization reverts if liquidated damage is zero", async () => {
      const TermRepoCollateralManager = await ethers.getContractFactory(
        "TestTermRepoCollateralManager",
      );

      await expect(
        upgrades.deployProxy(
          TermRepoCollateralManager,
          [
            termIdString,
            BigInt("200000000000000000"),
            BigInt("50000000000000000"),
            BigInt("5000000000000000"),
            await fungibleToken3.getAddress(),
            [
              {
                tokenAddress: await fungibleToken1.getAddress(),
                initialCollateralRatio: "2000000000000000000",
                maintenanceRatio: "1500000000000000000",
                liquidatedDamage: "0",
              },
            ],
            await termEventEmitter.getAddress(),
            termInitializer.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("Liquidated damage is zero");
    });
  });
  describe("upgrade tests", () => {
    it("term repo locker upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoLocker.connect(devopsMultisig).upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(await termRepoLocker.getAddress(), wallet1.address);

      await expect(
        termRepoLocker.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWithCustomError(
      termRepoLocker,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("servicer upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoServicer.connect(devopsMultisig).upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(await termRepoServicer.getAddress(), wallet1.address);

      await expect(
        termRepoServicer.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("collateral manager upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoCollateralManager
          .connect(devopsMultisig)
          .upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(
          await termRepoCollateralManager.getAddress(),
          wallet1.address,
        );

      await expect(
        termRepoCollateralManager.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );
    });
  });

  describe("termRepoLocker tests", () => {
    it("all termRepoLocker functions revert if not called by termManager", async () => {
      await expect(
        termRepoLocker.transferTokenFromWallet(
          wallet1.address,
          await fungibleToken1.getAddress(),
          15,
        ),
      ).to.be.revertedWithCustomError(
      termRepoLocker,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoLocker.transferTokenToWallet(
          wallet1.address,
          await fungibleToken1.getAddress(),
          15,
        ),
      ).to.be.revertedWithCustomError(
      termRepoLocker,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("all termRepoLocker transfers revert if transfers paused, and resume when unpaused", async () => {
      // pausing reverts when not called by the admin
      await expect(
        termRepoLocker.connect(wallet2).pauseTransfers(),
      ).to.be.revertedWithCustomError(
        termRepoLocker,
        "AccessControlUnauthorizedAccount",
      );

      await expect(termRepoLocker.connect(adminWallet).pauseTransfers())
        .to.emit(termEventEmitter, "TermRepoLockerTransfersPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet1.address,
            await fungibleToken1.getAddress(),
            "15000000",
          ),
      ).to.be.revertedWithCustomError(
        termRepoLocker,
        "TermRepoLockerTransfersPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoLocker.connect(wallet2).unpauseTransfers(),
      ).to.be.revertedWithCustomError(
        termRepoLocker,
        "AccessControlUnauthorizedAccount",
      );

      await expect(termRepoLocker.connect(adminWallet).unpauseTransfers())
        .to.emit(termEventEmitter, "TermRepoLockerTransfersUnpaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet1.address,
            await fungibleToken1.getAddress(),
            "15000000",
          ),
      ).to.not.be.reverted;
    });
  });

  describe("auction functions access control", () => {
    it("all access controlled term manager functions revert if not called by addresses granted role", async () => {
      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .auctionLockCollateral(
            wallet2.address,
            await fungibleToken2.getAddress(),
            50,
          ),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "AccessControlUnauthorizedAccount",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .auctionUnlockCollateral(
            wallet2.address,
            await fungibleToken2.getAddress(),
            50,
          ),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "AccessControlUnauthorizedAccount",
      );

      await expect(
        termRepoServicer.connect(wallet1).lockOfferAmount(wallet1.address, wallet1.address, 15),
      ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoServicer
          .connect(wallet1)
          .fulfillOffer(wallet1.address, 15, 20, getBytesHash("offer-1")),
      ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .fulfillBid(
            wallet2.address,
            15,
            20,
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "AccessControlUnauthorizedAccount",
      );
    });
  });


  describe("collateral ledger balances", () => {
    it("initializes with zero balance for collateral", async () => {
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal(0);

      expect(
        await termRepoCollateralManager.getCollateralMarketValue(
          wallet1.address,
        ),
      ).to.equal(0);
    });

    it("auction locking and unlocking collateral does not updates balance", async function () {
      // locking collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("15000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      // unlocking collateral after maturation period completes (maturation timestamp is deployment block timestamp)
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionUnlockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "14000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("1000000");
    });
    it("revert external unlocking if borrow balance is 0", async function () {
      // locking collateral

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .externalUnlockCollateral(
            await fungibleToken1.getAddress(),
            "15000000",
          ),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        `ZeroCollateralBalance`,
      );

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("15000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      // unlocking collateral after maturation period completes (maturation timestamp is deployment block timestamp)
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionUnlockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "14000000",
        );

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("1000000");
    });

    it("reopening to another auction locking and unlocking collateral updates balance", async function () {
      // locking collateral
      await expect(
        termRepoCollateralManager.connect(wallet2).reopenToNewAuction({
          auction: anotherAuction.address,
          termAuctionBidLocker: anotherAuctionBidLocker.address,
          termAuctionOfferLocker: anotherAuctionOfferLocker.address,
        }),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );
      // locking collateral
      await expect(
        termRepoCollateralManager.connect(termInitializer).reopenToNewAuction({
          auction: anotherAuction.address,
          termAuctionBidLocker: anotherAuctionBidLocker.address,
          termAuctionOfferLocker: anotherAuctionOfferLocker.address,
        }),
      )
        .to.emit(termEventEmitter, "PairReopeningBidLocker")
        .withArgs(
          termIdHashed,
          await termRepoCollateralManager.getAddress(),
          anotherAuctionBidLocker.address,
        );

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralMarketValue(
          wallet1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("15000000");

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionUnlockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "14000000",
        );
      expect(
        await termRepoCollateralManager.getCollateralMarketValue(
          wallet1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(
        await fungibleToken1.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("1000000");
    });
  });
  describe("locked offer ledger balances", () => {
    it("locking and unlocking loan offers updates balance", async function () {
      // locking loan offer
      expect(
        await termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, wallet1.address, "15000000"),
      )
        .to.emit(termRepoServicer, "OfferLockedByServicer")
        .withArgs(termIdHashed, wallet1.address, "15000000");

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "285000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("15000000");

      // fulfilling loan offer when matched
      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillOffer(
            wallet1.address,
            "15000000",
            "20000000",
            getBytesHash("offer-1"),
          ),
      )
        .to.emit(termEventEmitter, "OfferFulfilled")
        .withArgs(
          getBytesHash("offer-1"),
          wallet1.address,
          "15000000",
          "20000000",
          "20000000",
        );

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "285000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("15000000");
    });
  });
  describe("making collateralized loans", () => {
    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with full redemption.", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        )
        .to.emit(termEventEmitter, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("15000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("15000000");

      expect(
        await termRepoCollateralManager.getCollateralMarketValue(
          wallet2.address,
        ),
      ).to.equal("15000000000000000000");

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(termRepoServicer, "AfterMaturity");

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RedemptionPeriodNotOpen",
      );

      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 2000000n,
          rolloverBidPriceHash: ZeroHash,
          processed: true,
        });
      await expect(termRepoServicer.connect(wallet2).submitRepurchasePayment(0))
        .to.be.revertedWithCustomError(termRepoServicer, "InvalidParameters")
        .withArgs("zero amount");

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment(MaxUint256),
      )
        .to.be.revertedWithCustomError(termRepoServicer, "InvalidParameters")
        .withArgs("repurchase amount cannot be uint max");

      // Non borrowers reverted when trying to repay
      await expect(
        termRepoServicer.connect(wallet3).submitRepurchasePayment("1200"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("20000000"),
      )
        .to.emit(termEventEmitter, "RepurchasePaymentSubmitted")
        .withArgs(termIdHashed, wallet2.address, "20000000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("0");

      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "42000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("20000000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.equal(0);
      expect(await fungibleToken2.balanceOf(wallet2.address)).to.equal(
        "300000000",
      );

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "20000000", 0);

      // revert if redeemer has no term repo tokens
      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroTermRepoTokenBalance",
      );

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "305000000",
      );
    });
    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with full redemption (RepurchaseAmountTooHigh).", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address,  "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        )
        .to.emit(termEventEmitter, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("15000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("15000000");

      expect(
        await termRepoCollateralManager.getCollateralMarketValue(
          wallet2.address,
        ),
      ).to.equal("15000000000000000000");

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(termRepoServicer, "AfterMaturity");

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RedemptionPeriodNotOpen",
      );

      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 2000000n,
          rolloverBidPriceHash: ZeroHash,
          processed: false,
        });
      await expect(termRepoServicer.connect(wallet2).submitRepurchasePayment(0))
        .to.be.revertedWithCustomError(termRepoServicer, "InvalidParameters")
        .withArgs("zero amount");

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment(MaxUint256),
      )
        .to.be.revertedWithCustomError(termRepoServicer, "InvalidParameters")
        .withArgs("repurchase amount cannot be uint max");

      // Non borrowers reverted when trying to repay
      await expect(
        termRepoServicer.connect(wallet3).submitRepurchasePayment("1200"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );
      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );
      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000"),
      )
        .to.emit(termEventEmitter, "RepurchasePaymentSubmitted")
        .withArgs(termIdHashed, wallet2.address, "10000000");
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("10000000");
    });

    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with partial redemption due to low termRepoLocker balance.", async function () {
      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ZeroHash,
          locked: true,
          processed: true,
        });

      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000"),
      )
        .to.emit(termEventEmitter, "RepurchasePaymentSubmitted")
        .withArgs(termIdHashed, wallet2.address, "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RedemptionPeriodNotOpen",
      );
      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("10000000");

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000"),
      )
        .to.emit(termEventEmitter, "RepurchasePaymentSubmitted")
        .withArgs(termIdHashed, wallet2.address, "10000000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("0");

      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "42000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal("20000000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal(0);
      expect(await fungibleToken2.balanceOf(wallet2.address)).to.equal(
        "300000000",
      );

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      termRepoServicer.setPurchaseCurrencyHeld("19999999");

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, 19999999),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "19999999", 0);

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "304999999",
      );
    });

    it("valid loan, full repay and redeem where totalRepurchaseCollected is below redemptionValue (else branch of _parRedemption)", async function () {
      await termRepoRolloverManager.mock.getRolloverInstructions.returns({
        rolloverAuctionBidLocker: wallet3.address,
        rolloverAmount: "2000000",
        rolloverBidPriceHash: ZeroHash,
        locked: true,
        processed: true,
      });

      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      // Full repayment in two halves — locker ends up with 20000000 actual tokens
      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "20000000");

      await termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000");

      // Cover isTermRepoBalanced() public function (lines 400-402)
      expect(await termRepoServicer.isTermRepoBalanced()).to.be.true;

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      // Set totalRepurchaseCollected = 19990000 (threshold: 20000000 = 19990000 + 10000)
      // → par routing taken, but redemptionValue (20000000) > totalRepurchaseCollected (19990000)
      // → else branch of _parRedemption fires (lines 978-992)
      await termRepoServicer.setPurchaseCurrencyHeld("19990000");

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "19990000", 0);
    });

    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with partial redemption due to low termRepoLocker balance. (RepurchaseAmountTooHigh)", async function () {
      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ZeroHash,
          locked: false,
          processed: false,
        });

      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("10000000"),
      )
        .to.emit(termEventEmitter, "RepurchasePaymentSubmitted")
        .withArgs(termIdHashed, wallet2.address, "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RedemptionPeriodNotOpen",
      );
      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );
    });
    it("valid loan (with protocol loan share), half repay and redeem with half redemption", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "10500000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-id-1"),
        );

      await expect(
        await termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["10500000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "EncumberedCollateralRemaining",
      );

      await termRepoCollateralManager
        .connect(wallet3)
        .batchDefault(wallet2.address, ["0", "10000000"]);

      console.log(await fungibleToken3.balanceOf(wallet1.address));
      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "10000000", (5e17).toString());

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "295000000",
      );
    });
    it("valid loan (with protocol loan share), half repay and redeem with half redemptions where final redeemer cannot redeem full", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "10500000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "7500000");

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, wallet3.address, "7500000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "7500000",
          "10000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet3.address,
          "7500000",
          "10000000",
          getBytesHash("offer-id-2"),
        );

      const wallet3fun3Balance = await fungibleToken3.balanceOf(
        wallet3.address,
      );

      await expect(
        await termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["10500000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "EncumberedCollateralRemaining",
      );

      await termRepoCollateralManager
        .connect(wallet3)
        .batchDefault(wallet2.address, ["0", "10000000"]);

      console.log(await fungibleToken3.balanceOf(wallet1.address));
      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "10000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "5000000", (5e17).toString());

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "297500000",
      );
      await termRepoServicer.setPurchaseCurrencyHeld(5000000 - 1);

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet3.address, "10000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(
          termIdHashed,
          wallet3.address,
          5000000 - 1,
          (5e17).toString(),
        );

      expect(await fungibleToken3.balanceOf(wallet3.address)).to.equal(
        wallet3fun3Balance + (5000000n - 1n - 10000000n), // includes liq repayment
      );
    });
    it("valid loan from reopening auction", async function () {
      await expect(
        termRepoServicer.connect(termInitializer).reopenToNewAuction({
          auction: anotherAuction.address,
          termAuctionBidLocker: anotherAuctionBidLocker.address,
          termAuctionOfferLocker: anotherAuctionOfferLocker.address,
        }),
      )
        .to.emit(termEventEmitter, "ReopeningOfferLockerPaired")
        .withArgs(
          termIdHashed,
          await termRepoServicer.getAddress(),
          anotherAuctionOfferLocker.address,
          anotherAuction.address,
        );
      await expect(
        termRepoCollateralManager.connect(termInitializer).reopenToNewAuction({
          auction: anotherAuction.address,
          termAuctionBidLocker: anotherAuctionBidLocker.address,
          termAuctionOfferLocker: anotherAuctionOfferLocker.address,
        }),
      )
        .to.emit(termEventEmitter, "PairReopeningBidLocker")
        .withArgs(
          termIdHashed,
          await termRepoCollateralManager.getAddress(),
          anotherAuctionBidLocker.address,
        );

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(anotherAuctionOfferLocker)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(anotherAuction)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await expect(
        termRepoServicer
          .connect(anotherAuction)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );

      expect(await fungibleToken3.balanceOf(treasuryWallet.address)).to.equal(
        "3000000",
      );
      expect(await fungibleToken3.balanceOf(wallet2.address)).to.equal(
        "62000000",
      );
      expect(
        await fungibleToken3.balanceOf(await termRepoLocker.getAddress()),
      ).to.equal(0);

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(await termRepoLocker.getAddress(), "10000000");
    });

    it("valid create position loan and full collapse around a standing rollover", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      await termController.mock.verifyMintExposureAccess.returns(true);

      // primary dealer mint reverts due to invalid collateral array
      await expect(
        termRepoServicer
          .connect(wallet2)
          .mintOpenExposure("20000000", ["15000000"]),
      )
        .to.be.revertedWithCustomError(termRepoServicer, `InvalidParameters`)
        .withArgs(
          "Collateral Amounts array not same length as collateral tokens list",
        );

      // primary dealer mint reverts due to insufficient collateral
      await expect(
        termRepoServicer
          .connect(wallet2)
          .mintOpenExposure("20000000", ["0", "15000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "InsufficientCollateral",
      );

      await network.provider.send("evm_setNextBlockTimestamp", [
        termStartTimestamp + 60 * 60 * 12 * 360,
      ]);

      await network.provider.send("evm_mine");

      await expect(
        termRepoServicer
          .connect(wallet2)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      )
        .to.emit(termEventEmitter, "TermRepoTokenMint")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17940626",
          "2059374",
          "20000000",
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("20000000");

        expect(await testTermRepoToken.balanceOf(wallet2.address)).to.eq(
          "37940626",
        );
        expect(await testTermRepoToken.balanceOf(treasuryWallet.address)).to.eq(
          "2059374",
        );

      // revert if attempt to collapse with no borrow balance
      await expect(
        termRepoServicer.connect(wallet3).burnCollapseExposure("37944445"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      const user: SignerWithAddress = wallet2;

      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 5000000n,
          rolloverBidPriceHash: ZeroHash,
          locked: false,
          processed: false,
        });

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("37940626"),
      )
        .to.emit(termEventEmitter, "BurnCollapseExposure")
        .withArgs(termIdHashed, wallet2.address, "15000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "22940626",
      );
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(5000000);

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(termRepoServicer, "AfterMaturity");

      await network.provider.send("evm_increaseTime", [60 * 60 * 9]);

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("40000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "AfterRepurchaseWindow",
      );
    });
    it("valid create position loan and full collapse around a standing rollover (NoMintExposureAccess)", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );
      await termController.mock.verifyMintExposureAccess.returns(false);
      await expect(
        termRepoServicer
          .connect(wallet2)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "NoMintOpenExposureAccess",
      );
    });
    it("valid create position loan and full collapse around a fulfilled rollover", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      let user: SignerWithAddress = wallet2;

      await termController.mock.verifyMintExposureAccess.returns(true);

      // primary dealer mint reverts due to invalid collateral array
      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["15000000"]),
      )
        .to.be.revertedWithCustomError(termRepoServicer, `InvalidParameters`)
        .withArgs(
          "Collateral Amounts array not same length as collateral tokens list",
        );

      // primary dealer mint reverts due to insufficient collateral
      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "15000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "InsufficientCollateral",
      );

      await network.provider.send("evm_setNextBlockTimestamp", [
        termStartTimestamp + 60 * 60 * 12 * 360,
      ]);

      await network.provider.send("evm_mine");

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      )
        .to.emit(termEventEmitter, "TermRepoTokenMint")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17940626",
          "2059374",
          "20000000",
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.eq(
        "37940626",
      );
      expect(await testTermRepoToken.balanceOf(treasuryWallet.address)).to.eq(
        "2059374",
      );

      // revert if attempt to collapse with no borrow balance
      await expect(
        termRepoServicer.connect(wallet3).burnCollapseExposure("37940626"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      user = wallet2;

      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 5000000n,
          rolloverBidPriceHash: ZeroHash,
          locked: false,
          processed: true,
        });

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("37940626"),
      )
        .to.emit(termEventEmitter, "BurnCollapseExposure")
        .withArgs(termIdHashed, wallet2.address, "20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "17940626",
      );
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
    });
    it("valid create position loan and full collapse around a fulfilled rollover (NoMintOpenExposureAccess)", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      let user: SignerWithAddress = wallet2;

      await termController.mock.verifyMintExposureAccess.returns(false);

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "NoMintOpenExposureAccess",
      );
    });

    it("valid create position loan and full collapse around a non fulfilled complete rollover reverts", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      let user: SignerWithAddress = wallet2;

      await termController.mock.verifyMintExposureAccess.returns(true);

      // primary dealer mint reverts due to invalid collateral array
      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["15000000"]),
      )
        .to.be.revertedWithCustomError(termRepoServicer, `InvalidParameters`)
        .withArgs(
          "Collateral Amounts array not same length as collateral tokens list",
        );

      // primary dealer mint reverts due to insufficient collateral
      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "15000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "InsufficientCollateral",
      );

      await network.provider.send("evm_setNextBlockTimestamp", [
        termStartTimestamp + 60 * 60 * 12 * 360,
      ]);

      await network.provider.send("evm_mine");

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      )
        .to.emit(termEventEmitter, "TermRepoTokenMint")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17940626",
          "2059374",
          "20000000",
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.eq(
        "37940626",
      );
      expect(await testTermRepoToken.balanceOf(treasuryWallet.address)).to.eq(
        "2059374",
      );

      // revert if attempt to collapse with no borrow balance
      await expect(
        termRepoServicer.connect(wallet3).burnCollapseExposure("37940626"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      user = wallet2;

      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 20000000n,
          rolloverBidPriceHash: ZeroHash,
          locked: false,
          processed: false,
        });

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("37940626"),
      ).to.be.revertedWithCustomError(termRepoServicer, "ZeroMaxRepurchase");
    });

    it("valid create position loan and full collapse around a non fulfilled complete rollover reverts (No mint exposure access)", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      let user: SignerWithAddress = wallet2;

      await termController.mock.verifyMintExposureAccess.returns(false);

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "NoMintOpenExposureAccess",
      );
    });

    it("valid loan (with protocol loan share) after term maturity and partial collapse", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "15000000",
            "20000000",
            [await fungibleToken2.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "15000000",
          "20000000",
          "3000000",
        );
      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet1.address,
            "15000000",
            "20000000",
            [await fungibleToken1.getAddress()],
            ["15000000"],
            "1000000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet1.address,
          "15000000",
          "20000000",
          "3000000",
        );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      const user = wallet2;
      await termRepoRolloverManager.mock.getRolloverInstructions
        // .withArgs(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: 0n,
          rolloverBidPriceHash: ZeroHash,
          locked: false,
          processed: true,
        });
      await expect(
        termRepoServicer.connect(user).burnCollapseExposure(10000000n),
      )
        .to.emit(termEventEmitter, "BurnCollapseExposure")
        .withArgs(termIdHashed, wallet2.address, "10000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "10000000",
      );
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("10000000");
    });
    it("invalid collapse attempt after repurchase window", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "15000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken1.getAddress(),
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet2.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [await fungibleToken1.getAddress()],
          ["15000000"],
          "1000000000000000000",
        );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoServicer.connect(wallet2).burnCollapseExposure("10000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "AfterRepurchaseWindow",
      );

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "20000000",
      );
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("20000000");
    });

    it("revert repaying loan if maturation period is not complete or after repurchase window", async () => {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["10000000"],
          "1000000000000000000",
        );

      const user = wallet2;

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoServicer.connect(user).submitRepurchasePayment(wallet2.address),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "AfterRepurchaseWindow",
      );
    });

    describe("mintOpenExposureFromIntent", () => {
      it("reverts if caller does not have DIAMOND_ROLE", async function () {
        await expect(
          termRepoServicer
            .connect(wallet2)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["0", "50000000"],
              "100000000000000000",
              false,
            ),
        ).to.be.revertedWithCustomError(
          termRepoServicer,
          "AccessControlUnauthorizedAccount",
        );
      });

      it("reverts if called after maturity", async function () {
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60,
        ]);
        await network.provider.send("evm_mine");

        await expect(
          termRepoServicer
            .connect(termDiamond)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["0", "50000000"],
              "100000000000000000",
              false,
            ),
        ).to.be.revertedWithCustomError(termRepoServicer, "AfterMaturity");
      });

      it("reverts with invalid collateral array length", async function () {
        await expect(
          termRepoServicer
            .connect(termDiamond)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["50000000"],
              "100000000000000000",
              false,
            ),
        )
          .to.be.revertedWithCustomError(termRepoServicer, "InvalidParameters")
          .withArgs(
            "Collateral Amounts array not same length as collateral tokens list",
          );
      });

      it("reverts with insufficient collateral", async function () {
        await expect(
          termRepoServicer
            .connect(termDiamond)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["0", "0"],
              "100000000000000000",
              false,
            ),
        ).to.be.revertedWithCustomError(
          termRepoServicer,
          "InsufficientCollateral",
        );
      });

      it("opens a position with collateral from borrower (isRoutedCollateral = false)", async function () {
        await expect(
          termRepoServicer
            .connect(termDiamond)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["0", "50000000"],
              "100000000000000000",
              false,
            ),
        ).to.emit(termEventEmitter, "TermRepoTokenMint");

        expect(
          await testTermRepoToken.balanceOf(wallet2.address),
        ).to.be.gt(0);

        expect(
          await termRepoServicer.getBorrowerRepurchaseObligation(wallet1.address),
        ).to.be.gt(0);
      });

      it("opens a position with collateral routed from caller (isRoutedCollateral = true)", async function () {
        // Transfer fungibleToken2 to termDiamond and approve termRepoLocker
        await fungibleToken2
          .connect(wallet1)
          .transfer(termDiamond.address, "50000000");
        await fungibleToken2
          .connect(termDiamond)
          .approve(await termRepoLocker.getAddress(), "50000000");

        await expect(
          termRepoServicer
            .connect(termDiamond)
            .mintOpenExposureFromIntent(
              wallet1.address,
              wallet2.address,
              "15000000",
              ["0", "50000000"],
              "100000000000000000",
              true,
            ),
        ).to.emit(termEventEmitter, "TermRepoTokenMint");

        expect(
          await testTermRepoToken.balanceOf(wallet2.address),
        ).to.be.gt(0);

        expect(
          await termRepoServicer.getBorrowerRepurchaseObligation(wallet1.address),
        ).to.be.gt(0);
      });
    });
  });
  describe("borrower collateral unlocking/locking after taking loan", () => {
    it("loan and valid additional collateral locking", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["150000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(await fungibleToken2.getAddress(), "5000000"),
      )
        .to.emit(termEventEmitter, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "5000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("155000000");
    });
    it("zero collateral balance reverts collateral unlocking", async () => {
      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalUnlockCollateral(await fungibleToken1.getAddress(), "0"),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "InvalidParameters",
        )
        .withArgs("Zero amount");
    });
    it("other invalid collateral lockings", async () => {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "0",
          "1",
          [await fungibleToken2.getAddress()],
          ["15000000"],
          "1",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalUnlockCollateral(
            await fungibleToken2.getAddress(),
            "150000001",
          ),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "UnlockAmountGreaterThanCollateralBalance",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(await fungibleToken3.getAddress(), "5000000"),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralTokenNotAllowed`,
        )
        .withArgs(await fungibleToken3.getAddress());

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(await fungibleToken2.getAddress(), "5000000"),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        `CollateralDepositClosed`,
      );
    });
    it("loan and valid external single collateral type unlocking", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );

      await expect(
        termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, wallet1.address, "15000000"),
      )
        .to.emit(termEventEmitter, "OfferLockedByServicer")
        .withArgs(termIdHashed, wallet1.address, "15000000");

      await expect(
        termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .unlockOfferAmount(wallet1.address, "5000000"),
      )
        .to.emit(termEventEmitter, "OfferUnlockedByServicer")
        .withArgs(termIdHashed, wallet1.address, "5000000");

      await expect(
        termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, wallet1.address, "5000000"),
      )
        .to.emit(termEventEmitter, "OfferLockedByServicer")
        .withArgs(termIdHashed, wallet1.address, "5000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["50000000"],
          "1000000000000000000",
        );

      const user = wallet2;

      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(
            await fungibleToken2.getAddress(),
            "5000000",
          ),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "5000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("45000000");
    });
    it("external unlock collateral reverts when not called by borrower", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["50000000"],
          "1000000000000000000",
        );
    });
    it("external unlock collateral reverts when not valid collateral type and if during repurchase, unlock succeeds after repurchase", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["50000000"],
          "1000000000000000000",
        );
      const user = wallet2;
      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalUnlockCollateral(
            await fungibleToken3.getAddress(),
            "5000000",
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralTokenNotAllowed`,
        )
        .withArgs(await fungibleToken3.getAddress());

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]);

      await network.provider.send("evm_increaseTime", [60 * 60 * 8]);
      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(
            await fungibleToken2.getAddress(),
            "100000",
          ),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "CollateralWithdrawalClosed",
      );

      await network.provider.send("evm_increaseTime", [60 * 15]);
      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(
            await fungibleToken2.getAddress(),
            "100000",
          ),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "100000",
        );
    });
    it("external unlock collateral reverts when collateral falls below maintenance ratio", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "15000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "15000000",
          "20000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "15000000",
          "20000000",
          [await fungibleToken2.getAddress()],
          ["50000000"],
          "1000000000000000000",
        );

      const user = wallet2;

      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(
            await fungibleToken2.getAddress(),
            "20000001",
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralBelowMaintenanceRatios`,
        )
        .withArgs(wallet2.address, await fungibleToken2.getAddress());
    });
  });
  describe("borrower collateral liquidations", () => {
    it("valid batch liquidation", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["10000000", "50000000"],
          "1000000000000000000",
        );

      const user = wallet3;
      const batchLiquidation = await termRepoCollateralManager
        .connect(user)
        .batchLiquidation(wallet2.address, ["10000000", "10000000"]);

      await expect(batchLiquidation)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet3.address,
          "10000000",
          await fungibleToken2.getAddress(),
          "10500000",
          "2000000",
          false,
        );

      await expect(batchLiquidation)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet3.address,
          "10000000",
          await fungibleToken1.getAddress(),
          "5250000",
          "1000000",
          false,
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("70000000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("39500000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("4750000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("4750000");

      expect(await fungibleToken2.balanceOf(wallet3.address)).to.equal(
        "308500000",
      );
      expect(await fungibleToken2.balanceOf(reserveAddress.address)).to.equal(
        "2000000",
      );
      expect(await fungibleToken1.balanceOf(wallet3.address)).to.equal(
        "4250000",
      );
      expect(await fungibleToken1.balanceOf(reserveAddress.address)).to.equal(
        "1000000",
      );
    });

    it("nondefault liquidations reverted when paused, and succeed once unpaused", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "30000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["30000000", "50000000"],
          "1000000000000000000",
        );

      // pausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).pauseLiquidations(),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager.connect(adminWallet).pauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["10000000", "10000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "LiquidationsPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).unpauseLiquidations(),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager.connect(adminWallet).unpauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsUnpaused")
        .withArgs(termIdHashed);

      const user = wallet3;
      const batchLiquidation = await termRepoCollateralManager
        .connect(user)
        .batchLiquidation(wallet2.address, ["0", "100"]);

      await expect(batchLiquidation).to.emit(termEventEmitter, "Liquidation");
    });

    it("revert liquidation requests with invalid collateral tokens", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "50000000"],
          "1000000000000000000",
        );

      const user = wallet3;
      await expect(
        termRepoCollateralManager
          .connect(user)
          .batchLiquidation(wallet2.address, ["10000000"]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs(
          "Closure amounts array not same length as collateral tokens list",
        );
    });
    it("revert invalid liquidations within shortfall", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [await fungibleToken2.getAddress()],
          ["10000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .batchLiquidation(wallet2.address, [2000, 20000]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "SelfLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, [0, 0]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, [MaxUint256, 0]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs("closureAmounts cannot be uint max");
      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, [0, 20000000]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InsufficientCollateralForLiquidationRepayment`,
        )
        .withArgs(await fungibleToken2.getAddress());

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, [0, 20000000000]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );
    });
    it("revert single liquidations not within shortfall", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "150000000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [await fungibleToken2.getAddress()],
          ["150000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["20000000", "20000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "BorrowerNotInShortfall",
      );
    });
    it("disallow total shortfall liquidation ", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "100000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000",
          "90000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000",
          "90000",
          [await fungibleToken2.getAddress()],
          ["100000"],
          "10000",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.eq("100000");

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["0", "90000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ExceedsNetExposureCapOnLiquidation",
      );
    });

    it("allow total liquidation if within minimum margin", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "290",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "300");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(wallet1.address, "300", "400", getBytesHash("offer-1"));

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "300",
          "400",
          [await fungibleToken1.getAddress()],
          ["290"],
          "100",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("290");

      await termRepoCollateralManager
        .connect(wallet3)
        .batchLiquidation(wallet2.address, ["400", "0"]);

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("0");

      // Check that all collateral is returned to the borrower after full liquidation
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("0");

      // Check that the borrower's token balance includes the returned collateral
      expect(await fungibleToken1.balanceOf(wallet2.address)).to.equal("249999790");
    });

    it("revert batch liquidations of borrowers with no balance", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "17000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["29000000", "0"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroBorrowerRepurchaseObligation",
      );
    });

    it("revert batch liquidations not within maxRepayment", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "17000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "20000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "20000000",
          "30000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "20000000",
          "30000000",
          [await fungibleToken1.getAddress()],
          ["17000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["29000000", "0"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ExceedsNetExposureCapOnLiquidation",
      );
    });
  });
  describe("borrower collateral liquidations witht repo token", () => {
    it("valid batch liquidation with Repo Token", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["10000000", "50000000"],
          "1000000000000000000",
        );

      const f1W1BalanceBefore = await fungibleToken1.balanceOf(wallet1.address);
      const f2W1BalanceBefore = await fungibleToken2.balanceOf(wallet1.address);

      const batchLiquidationWithRepoToken = await termRepoCollateralManager
        .connect(wallet1)
        .batchLiquidationWithRepoToken(wallet2.address, [
          "10000000",
          "10000000",
        ]);

      await expect(batchLiquidationWithRepoToken)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet1.address,
          "10000000",
          await fungibleToken2.getAddress(),
          "10500000",
          "2000000",
          false,
        );

      await expect(batchLiquidationWithRepoToken)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet1.address,
          "10000000",
          await fungibleToken1.getAddress(),
          "5250000",
          "1000000",
          false,
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("70000000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("39500000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("4750000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("4750000");

      expect(
        (await fungibleToken2.balanceOf(wallet1.address)) - f2W1BalanceBefore,
      ).to.equal("8500000");
      expect(await fungibleToken2.balanceOf(reserveAddress.address)).to.equal(
        "2000000",
      );
      expect(
        (await fungibleToken1.balanceOf(wallet1.address)) - f1W1BalanceBefore,
      ).to.equal("4250000");
      expect(await fungibleToken1.balanceOf(reserveAddress.address)).to.equal(
        "1000000",
      );
    });

    it("nondefault liquidations with repo token reverted when paused, and succeed once unpaused", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "30000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["30000000", "50000000"],
          "1000000000000000000",
        );

      // pausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).pauseLiquidations(),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager.connect(adminWallet).pauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, [
            "10000000",
            "10000000",
          ]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "LiquidationsPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).unpauseLiquidations(),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager.connect(adminWallet).unpauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsUnpaused")
        .withArgs(termIdHashed);

      const batchLiquidation = await termRepoCollateralManager
        .connect(wallet1)
        .batchLiquidationWithRepoToken(wallet2.address, ["0", "100"]);

      await expect(batchLiquidation).to.emit(termEventEmitter, "Liquidation");
    });

    it("revert liquidation requests with invalid collateral tokens", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "50000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidationWithRepoToken(wallet2.address, ["10000000"]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs(
          "Closure amounts array not same length as collateral tokens list",
        );
    });
    it("revert invalid repo token liquidations within shortfall", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "10000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          await fungibleToken2.getAddress(),
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "90000001");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [await fungibleToken2.getAddress()],
          ["10000000"],
          "1000000000000000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "10000001",
          "20000001",
          getBytesHash("offer-id-2"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "10000001",
          "20000001",
          [await fungibleToken2.getAddress()],
          ["10000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .batchLiquidationWithRepoToken(wallet2.address, [2000, 20000]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "SelfLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, [0, 0]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, [MaxUint256, 0]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs("closureRepoTokenAmounts cannot be uint max");
      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, [0, 20000000]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InsufficientCollateralForLiquidationRepayment`,
        )
        .withArgs(await fungibleToken2.getAddress());

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, [0, 90000001]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );
    });
    it("revert single liquidations not within shortfall", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "150000000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [await fungibleToken2.getAddress()],
          ["150000000"],
          "1000000000000000000",
        );

      const user = wallet1;
      await expect(
        termRepoCollateralManager
          .connect(user)
          .batchLiquidationWithRepoToken(wallet2.address, [
            "20000000",
            "20000000",
          ]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "BorrowerNotInShortfall",
      );
    });
    it("disallow total shortfall liquidation with repo token ", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "100000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          await fungibleToken2.getAddress(),
          "100000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "90000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000",
          "90000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "10000",
          "20000",
          getBytesHash("offer-2"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000",
          "90000",
          [await fungibleToken2.getAddress()],
          ["100000"],
          "10000",
        );
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "10000",
          "20000",
          [await fungibleToken2.getAddress()],
          ["100000"],
          "10000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, ["0", "90000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ExceedsNetExposureCapOnLiquidation",
      );
    });

    it("allow total liquidation if within minimum margin", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "290",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          await fungibleToken2.getAddress(),
          "2000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "1300");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(wallet1.address, "300", "400", getBytesHash("offer-1"));

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(wallet1.address, "1000", "1400", getBytesHash("offer-2"));

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "300",
          "400",
          [await fungibleToken1.getAddress()],
          ["290"],
          "100",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "1000",
          "1400",
          [await fungibleToken2.getAddress()],
          ["2000"],
          "100",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("290");

      const user = wallet1;
      await termRepoCollateralManager
        .connect(user)
        .batchLiquidationWithRepoToken(wallet2.address, ["400", "0"]);

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("0");

      // Check that all collateral is returned to the borrower after full liquidation
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("0");

      // Check that the borrower's token balance includes the returned collateral
      expect(await fungibleToken1.balanceOf(wallet2.address)).to.equal("249999790");
    });

    it("revert batch liquidations with repo token of borrowers with no balance", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "17000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidationWithRepoToken(wallet2.address, ["29000000", "0"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroBorrowerRepurchaseObligation",
      );
    });

    it("revert batch liquidations not within maxRepayment", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "17000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "20000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "20000000",
          "30000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "20000000",
          "30000000",
          [await fungibleToken1.getAddress()],
          ["17000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .batchLiquidationWithRepoToken(wallet2.address, ["29000000", "0"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ExceedsNetExposureCapOnLiquidation",
      );
    });
  });

  describe("borrower collateral defaults", () => {
    it("valid batch default", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "150000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "20000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "20000000",
          "30000000",
          getBytesHash("offer-id-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "20000000",
          "30000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "150000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["10000000", "10000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "DefaultsClosed",
      );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchLiquidation(wallet2.address, ["20000000", "20000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ShortfallLiquidationsClosed",
      );

      // batch default revaults due to repurchase being beyond borrow balance
      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["15000000", "15000001"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "TotalRepaymentGreaterThangetBorrowerRepurchaseObligation",
      );

      // batch default revaults due to mismatched collateral token and repurchase lengths
      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["15000000"]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs(
          "Closure amounts array not same length as collateral tokens list",
        );

      // partial batch default
      const batchDefault1 = await termRepoCollateralManager
        .connect(wallet3)
        .batchDefault(wallet2.address, ["10000000", "10000000"]);

      await expect(batchDefault1)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet3.address,
          "10000000",
          await fungibleToken2.getAddress(),
          "10500000",
          "2000000",
          true,
        );
      await expect(batchDefault1)
        .to.emit(termEventEmitter, "Liquidation")
        .withArgs(
          termIdHashed,
          wallet2.address,
          wallet3.address,
          "10000000",
          await fungibleToken1.getAddress(),
          "5250000",
          "1000000",
          true,
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq("44750000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.eq("139500000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("10000000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("139500000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("44750000");
      expect(await fungibleToken2.balanceOf(wallet3.address)).to.equal(
        "308500000",
      );
      expect(await fungibleToken2.balanceOf(reserveAddress.address)).to.equal(
        "2000000",
      );
      expect(await fungibleToken1.balanceOf(wallet3.address)).to.equal(
        "4250000",
      );
      expect(await fungibleToken1.balanceOf(reserveAddress.address)).to.equal(
        "1000000",
      );
      /// default to 0 to remove all encumbered colltateral
      await termRepoCollateralManager
        .connect(wallet3)
        .batchDefault(wallet2.address, ["10000000", "0"]);

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.eq(0);

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.eq(0);

      await termRepoCollateralManager
        .connect(wallet2)
        .externalUnlockCollateral(
          await fungibleToken2.getAddress(),
          "139500000",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.eq(0);
    });

    it("default liquidations reverted when paused, and succeed once unpaused", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "20000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "20000000",
          "30000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "20000000",
          "30000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "50000000"],
          "1000000000000000000",
        );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoCollateralManager.connect(adminWallet).pauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["10000000", "10000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "LiquidationsPaused",
      );

      await expect(
        termRepoCollateralManager.connect(adminWallet).unpauseLiquidations(),
      )
        .to.emit(termEventEmitter, "LiquidationsUnpaused")
        .withArgs(termIdHashed);

      const batchDefault1 = await termRepoCollateralManager
        .connect(wallet3)
        .batchDefault(wallet2.address, ["10000000", "10000000"]);

      await expect(batchDefault1).to.emit(termEventEmitter, "Liquidation");
    });

    it("revert improper default requests", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "40000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "80000000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "80000000",
          "90000000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "80000000",
          "90000000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["40000000", "50000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["10000000", "10000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "DefaultsClosed",
      );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .batchDefault(wallet2.address, ["10000000", "10000000"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "SelfLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["10000000"]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InvalidParameters`,
        )
        .withArgs(
          "Closure amounts array not same length as collateral tokens list",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, [0, 0]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroLiquidationNotPermitted",
      );

      await expect(
        termRepoCollateralManager.batchDefault(wallet2.address, [
          MaxUint256,
          "1000000",
        ]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "InvalidParameters",
        )
        .withArgs("closureAmounts cannot be uint max");

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet1.address, ["0", "0"]),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "ZeroBorrowerRepurchaseObligation",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet3)
          .batchDefault(wallet2.address, ["90000000", "1"]),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `InsufficientCollateralForLiquidationRepayment`,
        )
        .withArgs(await fungibleToken1.getAddress());

      // TODO: add test for excessive repayment
    });

    describe("batchDefaultWithRepoToken", () => {
      beforeEach(async () => {
        // Set up collateral and create positions for testing
        await termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet2.address,
            await fungibleToken2.getAddress(),
            "150000000",
          );
        await termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet2.address,
            await fungibleToken1.getAddress(),
            "50000000",
          );

        await termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, wallet1.address, "20000000");

        await termRepoServicer
          .connect(termAuctionAddress)
          .fulfillOffer(
            wallet1.address,
            "20000000",
            "30000000",
            getBytesHash("offer-id-1"),
          );

        await termRepoServicer
          .connect(termAuctionAddress)
          .fulfillBid(
            wallet2.address,
            "20000000",
            "30000000",
            [
              await fungibleToken1.getAddress(),
              await fungibleToken2.getAddress(),
            ],
            ["50000000", "150000000"],
            "1000000000000000000",
          );

        // Note: Time is not increased here to test DefaultsClosed first
      });

      it("should revert when defaults are closed (before repurchase window ends)", async function () {
        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet2.address, ["10000000", "10000000"]),
        ).to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "DefaultsClosed",
        );
      });

      it("should revert on self-liquidation attempt", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await expect(
          termRepoCollateralManager
            .connect(wallet2)
            .batchDefaultWithRepoToken(wallet2.address, ["10000000", "10000000"]),
        ).to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "SelfLiquidationNotPermitted",
        );
      });

      it("should revert when arrays have mismatched lengths", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet2.address, ["10000000"]),
        )
          .to.be.revertedWithCustomError(
            termRepoCollateralManager,
            "InvalidParameters",
          )
          .withArgs(
            "Closure repo token amounts array not same length as collateral tokens list",
          );
      });

      it("should revert when using uint256.max in closure amounts", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet2.address, [MaxUint256, "10000000"]),
        )
          .to.be.revertedWithCustomError(
            termRepoCollateralManager,
            "InvalidParameters",
          )
          .withArgs("closureRepoTokenAmounts cannot be uint max");
      });

      it("should revert when borrower has zero repurchase obligation", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet3.address, ["0", "0"]),
        ).to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "ZeroBorrowerRepurchaseObligation",
        );
      });

      it("should revert when total closure amount is zero", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet2.address, ["0", "0"]),
        ).to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "ZeroLiquidationNotPermitted",
        );
      });

      it("should execute valid batch default with repo token", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        // wallet1 has repo tokens from fulfilling the offer in beforeEach
        const batchDefaultTx = await termRepoCollateralManager
          .connect(wallet1)
          .batchDefaultWithRepoToken(wallet2.address, ["10000000", "10000000"]);

        // Verify Liquidation events are emitted
        await expect(batchDefaultTx)
          .to.emit(termEventEmitter, "Liquidation")
          .withArgs(
            termIdHashed,
            wallet2.address,
            wallet1.address,
            "10000000",
            await fungibleToken2.getAddress(),
            "10500000",
            "2000000",
            true,
          );

        await expect(batchDefaultTx)
          .to.emit(termEventEmitter, "Liquidation")
          .withArgs(
            termIdHashed,
            wallet2.address,
            wallet1.address,
            "10000000",
            await fungibleToken1.getAddress(),
            "5250000",
            "1000000",
            true,
          );

        // Verify collateral balances after partial liquidation
        expect(
          await termRepoCollateralManager.getEncumberedCollateralBalances(
            await fungibleToken1.getAddress(),
          ),
        ).to.eq("44750000");

        expect(
          await termRepoCollateralManager.getEncumberedCollateralBalances(
            await fungibleToken2.getAddress(),
          ),
        ).to.eq("139500000");

        // Verify borrower's remaining obligation
        expect(
          await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
        ).to.equal("10000000");
      });

      it("should unencumber all collateral when borrower obligation reaches zero", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        // wallet1 has repo tokens from fulfilling the offer in beforeEach
        // Complete liquidation to pay off full obligation
        await termRepoCollateralManager
          .connect(wallet1)
          .batchDefaultWithRepoToken(wallet2.address, ["30000000", "0"]);

        // Verify borrower obligation is zero
        expect(
          await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
        ).to.equal("0");

        // Verify all collateral is unencumbered
        expect(
          await termRepoCollateralManager.getEncumberedCollateralBalances(
            await fungibleToken1.getAddress(),
          ),
        ).to.eq("0");

        expect(
          await termRepoCollateralManager.getEncumberedCollateralBalances(
            await fungibleToken2.getAddress(),
          ),
        ).to.eq("0");
      });

      it("should revert when liquidations are paused", async function () {
        // Move past repurchase window to enable defaults
        await network.provider.send("evm_increaseTime", [
          60 * 60 * 24 * 365 + 60 * 60 + 60 * 60 * 10,
        ]);

        await termRepoCollateralManager.connect(adminWallet).pauseLiquidations();

        await expect(
          termRepoCollateralManager
            .connect(wallet1)
            .batchDefaultWithRepoToken(wallet2.address, ["10000000", "10000000"]),
        ).to.be.revertedWithCustomError(
          termRepoCollateralManager,
          "LiquidationsPaused",
        );
      });
    });
  });
  describe("rollover auction functions", () => {
    beforeEach(async () => {
      wallet3.sendTransaction({
        to: await termRepoRolloverManager.getAddress(),
        value: parseEther("1"),
      });

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [await termRepoRolloverManager.getAddress()],
      });
    });
    it("partially unlock rollover collateral to address", async function () {
      const termRepoRolloverManagerSigner = await ethers.getSigner(
        await termRepoRolloverManager.getAddress(),
      );

      await expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );
      await termRepoCollateralManager
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "40000000",
        );
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, wallet3.address, "50000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "50000",
          "60000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "40000000"],
          "100000000000",
        );

      expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager
          .connect(anotherAuction)
          .transferRolloverCollateral(
            wallet2.address,
            "500000000000000000",
            wallet3.address,
          ),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken1.getAddress(),
          "25000000",
        )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "20000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("25000000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("20000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("25000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("20000000");
    });
    it("unlock all rollover collateral to address", async function () {
      const termRepoRolloverManagerSigner = await ethers.getSigner(
        await termRepoRolloverManager.getAddress(),
      );

      await termRepoCollateralManager
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          await fungibleToken2.getAddress(),
          "40000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, wallet3.address, "50000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "50000",
          "6000",
          [
            await fungibleToken1.getAddress(),
            await fungibleToken2.getAddress(),
          ],
          ["50000000", "40000000"],
          "100000000000",
        );

      await expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoCollateralManager
          .connect(anotherAuction)
          .transferRolloverCollateral(
            wallet2.address,
            "1000000000000000000",
            wallet3.address,
          ),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken2.getAddress(),
          "40000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken2.getAddress(),
        ),
      ).to.equal("0");
    });
    it("accept rollover collateral from auction", async function () {
      expect(
        await termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .acceptRolloverCollateral(
            wallet2.address,
            await fungibleToken1.getAddress(),
            "50000000",
          ),
      )
        .to.emit(termRepoCollateralManager, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          await fungibleToken1.getAddress(),
          "50000000",
        );
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("50000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          await fungibleToken1.getAddress(),
        ),
      ).to.equal("50000000");
    });

    it("open rollover position from past term", async function () {
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, wallet2.address, "600000");
      await expect(
        termRepoServicer
          .connect(wallet2)
          .openExposureOnRolloverNew(
            wallet1.address,
            "500000",
            "550000",
            wallet3.address,
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );
      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .openExposureOnRolloverNew(
            wallet1.address,
            "500000",
            "550000",
            wallet3.address,
            "500000000000000000",
          ),
      )
        .to.emit(termEventEmitter, "ExposureOpenedOnRolloverNew")
        .withArgs(termIdHashed, wallet1.address, "450000", "550000", "50000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet1.address),
      ).to.equal("550000");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      // cannot open rollover positions after term matured
      await expect(
        termRepoServicer
          .connect(termAuctionAddress)
          .openExposureOnRolloverNew(
            wallet1.address,
            "500000",
            "550000",
            wallet3.address,
            "500000000000000000",
          ),
      ).to.be.revertedWithCustomError(termRepoServicer, "AfterMaturity");
    });

    it("collapse rollover position with loan from future term", async function () {
      const termRepoRolloverManagerSigner = await ethers.getSigner(
        await termRepoRolloverManager.getAddress(),
      );

      await expect(
        termRepoServicer.approveRolloverAuction(anotherAuction.address),
      ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AccessControlUnauthorizedAccount",
    );
      await termRepoServicer
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          await fungibleToken2.getAddress(),
          "1000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          await fungibleToken2.getAddress(),
          "1000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, wallet3.address, "590000");
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "590000",
          "600000",
          [await fungibleToken2.getAddress()],
          ["1000000"],
          "1000000000000000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet3.address,
          "590000",
          "600000",
          getBytesHash("offer-1"),
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, wallet1.address, "590000");
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "590000",
          "600000",
          [await fungibleToken2.getAddress()],
          ["1000000"],
          "1000000000000000000",
        );
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(
          wallet1.address,
          "590000",
          "600000",
          getBytesHash("offer-1"),
        );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .closeExposureOnRolloverExisting(wallet1.address, "600001"),
      ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AccessControlUnauthorizedAccount",
    );

      await expect(
        termRepoServicer
          .connect(anotherAuction)
          .closeExposureOnRolloverExisting(wallet1.address, "600001"),
      ).to.be.revertedWithCustomError(termRepoServicer, "NotMaturedYet");

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer
          .connect(anotherAuction)
          .closeExposureOnRolloverExisting(wallet1.address, "600001"),
      )
        .to.emit(termEventEmitter, "ExposureClosedOnRolloverExisting")
        .withArgs(termIdHashed, wallet1.address, "600000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet1.address),
      ).to.equal("0");

      expect(
        await termRepoServicer.totalOutstandingRepurchaseExposure(),
      ).to.equal("600000");
      expect(await termRepoServicer.totalRepurchaseCollected()).to.equal(
        "600000",
      );

      await expect(
        termRepoServicer
          .connect(anotherAuction)
          .closeExposureOnRolloverExisting(wallet3.address, "500000"),
      )
        .to.emit(termEventEmitter, "ExposureClosedOnRolloverExisting")
        .withArgs(termIdHashed, wallet3.address, "500000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet3.address),
      ).to.equal("100000");

      expect(
        await termRepoServicer.totalOutstandingRepurchaseExposure(),
      ).to.equal("100000");
      expect(await termRepoServicer.totalRepurchaseCollected()).to.equal(
        "1100000",
      );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      await expect(
        termRepoServicer
          .connect(anotherAuction)
          .closeExposureOnRolloverExisting(wallet1.address, "600001"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "AfterRepurchaseWindow",
      );
    });
  });

  it("version returns the current contract version (termRepoServicer)", async () => {
    expect(await termRepoServicer.version()).to.eq(expectedVersion);
  });
  it("version returns the current contract version (termRepoCollateralManager)", async () => {
    expect(await termRepoCollateralManager.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
