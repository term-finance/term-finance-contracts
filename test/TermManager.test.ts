/* eslint-disable camelcase */
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import dayjs from "dayjs";
import { BigNumber, Contract } from "ethers";
import { parseEther } from "ethers/lib/utils";
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
} from "../typechain-types";
// TODO: imitate multicall contract connection in termauth tests
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

  let termAuctionAddress: SignerWithAddress;
  let termAuctionBidLockerAddress: SignerWithAddress;
  let termAuctionOfferLockerAddress: SignerWithAddress;

  let termController: MockContract<ITermController>;
  let termEventEmitter: TermEventEmitter;
  let termRepoCollateralManager: TestTermRepoCollateralManager;
  let termRepoServicer: TestTermRepoServicer;
  let termRepoRolloverManager: FakeContract<ITermRepoRolloverManager>;
  let termRepoLocker: TestTermRepoLocker;

  let fungibleToken1: TestToken;
  let fungibleToken2: TestToken;
  let fungibleToken3: TestToken;

  let testTermRepoToken: Contract;
  let testOracleConsumer: TermPriceConsumerV3;

  let termIdString: String;

  let termIdHashed: String;

  let snapshotId: any;
  let expectedVersion: string;

  let termStartTimestamp: any;

  before(async () => {
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
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");

    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet3.address, termInitializer.address],
      {
        kind: "uups",
      },
    )) as TermEventEmitter;

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
    ])) as TestToken;
    fungibleToken2 = (await upgrades.deployProxy(TestToken, [
      "TestToken2",
      "TT2",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "300000000", "300000000"],
    ])) as TestToken;
    fungibleToken3 = (await upgrades.deployProxy(TestToken, [
      "TestToken3",
      "TT3",
      6,
      [wallet1.address, wallet2.address, wallet3.address],
      ["300000000", "50000000", "350000000"],
    ])) as TestToken;

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
    ])) as TermPriceConsumerV3;

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(fungibleToken1.address, fungibleToken1Feed.address);

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(fungibleToken2.address, fungibleToken2Feed.address);

    await testOracleConsumer
      .connect(devopsMultisig)
      .addNewTokenPriceFeed(fungibleToken3.address, fungibleToken3Feed.address);

    const mockTermControllerFactory =
      await smock.mock<TermController__factory>("TermController");
    termController = await mockTermControllerFactory.deploy();
    await termController.deployed();
    termController.getTreasuryAddress
      .whenCalledWith()
      .returns(treasuryWallet.address);
    termController.getProtocolReserveAddress
      .whenCalledWith()
      .returns(reserveAddress.address);

    termRepoRolloverManager = await smock.fake<TermRepoRolloverManager>(
      "TermRepoRolloverManager",
    );
    termRepoRolloverManager.fulfillRollover.returns();

    // Yet to Mature Term Management

    termStartTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
    const maturationTimestampOneYear = termStartTimestamp + 60 * 60 * 24 * 365;

    termIdString = maturationTimestampOneYear.toString() + "_ft3_ft1-ft2";

    termIdHashed = ethers.utils.solidityKeccak256(["string"], [termIdString]);

    termRepoCollateralManager = (await upgrades.deployProxy(
      TermRepoCollateralManager,
      [
        termIdString,
        BigNumber.from("200000000000000000"),
        BigNumber.from("50000000000000000"),
        BigNumber.from("5000000000000000"),
        fungibleToken3.address,
        [
          {
            tokenAddress: fungibleToken1.address,
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
          {
            tokenAddress: fungibleToken2.address,
            initialCollateralRatio: "2000000000000000000",
            maintenanceRatio: "1500000000000000000",
            liquidatedDamage: "50000000000000000",
          },
        ],
        termEventEmitter.address,
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as TestTermRepoCollateralManager;
    termRepoServicer = (await upgrades.deployProxy(
      TermRepoServicer,
      [
        termIdString,
        maturationTimestampOneYear,
        60 * 60 * 8,
        60 * 15,
        BigNumber.from("200000000000000000"),
        fungibleToken3.address,
        termController.address,
        termEventEmitter.address,
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as TestTermRepoServicer;
    termRepoLocker = (await upgrades.deployProxy(
      TermRepoLocker,
      [termIdString, termInitializer.address],
      {
        kind: "uups",
      },
    )) as TestTermRepoLocker;
    testTermRepoToken = await upgrades.deployProxy(
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
          purchaseToken: fungibleToken3.address,
          collateralTokens: [fungibleToken1.address, fungibleToken2.address],
          maintenanceCollateralRatios: ["1000000000000000000"],
        },
      ],
      {
        kind: "uups",
      },
    );
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoLocker.address);
    await expect(
      termRepoLocker
        .connect(wallet2)
        .pairTermContracts(
          termRepoCollateralManager.address,
          termRepoServicer.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
    );
    await termRepoLocker
      .connect(termInitializer)
      .pairTermContracts(
        termRepoCollateralManager.address,
        termRepoServicer.address,
        termEventEmitter.address,
        devopsMultisig.address,
        adminWallet.address,
      );
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoCollateralManager.address);
    await expect(
      termRepoCollateralManager
        .connect(wallet2)
        .pairTermContracts(
          termRepoLocker.address,
          termRepoServicer.address,
          termAuctionBidLockerAddress.address,
          termAuctionAddress.address,
          termController.address,
          testOracleConsumer.address,
          termRepoRolloverManager.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
    );
    await termRepoCollateralManager
      .connect(termInitializer)
      .pairTermContracts(
        termRepoLocker.address,
        termRepoServicer.address,
        termAuctionBidLockerAddress.address,
        termAuctionAddress.address,
        termController.address,
        testOracleConsumer.address,
        termRepoRolloverManager.address,
        devopsMultisig.address,
        adminWallet.address,
      );

    await expect(
      termRepoCollateralManager
        .connect(termInitializer)
        .pairTermContracts(
          termRepoLocker.address,
          termRepoServicer.address,
          termAuctionBidLockerAddress.address,
          termAuctionAddress.address,
          termController.address,
          testOracleConsumer.address,
          termRepoRolloverManager.address,
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
          termRepoCollateralManager.address,
          termRepoServicer.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoCollateralManager,
      "AlreadyTermContractPaired",
    );

    const collateralManagerInitializedFilter =
      termEventEmitter.filters.TermRepoCollateralManagerInitialized(
        null,
        null,
        null,
        null,
      );

    const termRepoCollateralManagerIntializedEvents =
      await termEventEmitter.queryFilter(collateralManagerInitializedFilter);

    expect(termRepoCollateralManagerIntializedEvents.length).to.equal(1);

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoServicer.address);

    await expect(
      termRepoServicer
        .connect(wallet2)
        .pairTermContracts(
          termRepoLocker.address,
          termRepoCollateralManager.address,
          testTermRepoToken.address,
          termAuctionOfferLockerAddress.address,
          termAuctionAddress.address,
          termRepoRolloverManager.address,
          devopsMultisig.address,
          adminWallet.address,
          "0.1.0",
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
    );
    await termRepoServicer
      .connect(termInitializer)
      .pairTermContracts(
        termRepoLocker.address,
        termRepoCollateralManager.address,
        testTermRepoToken.address,
        termAuctionOfferLockerAddress.address,
        termAuctionAddress.address,
        termRepoRolloverManager.address,
        devopsMultisig.address,
        adminWallet.address,
        "0.1.0",
      );

    await expect(
      termRepoServicer
        .connect(termInitializer)
        .pairTermContracts(
          termRepoLocker.address,
          termRepoCollateralManager.address,
          testTermRepoToken.address,
          termAuctionOfferLockerAddress.address,
          termAuctionAddress.address,
          termRepoRolloverManager.address,
          devopsMultisig.address,
          adminWallet.address,
          "0.1.0",
        ),
    ).to.be.revertedWithCustomError(
      termRepoServicer,
      "AlreadyTermContractPaired",
    );

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(testTermRepoToken.address);

    await testTermRepoToken
      .connect(termInitializer)
      .pairTermContracts(
        termRepoServicer.address,
        termEventEmitter.address,
        devopsMultisig.address,
        adminWallet.address,
      );
    const servicerInitializedFilter =
      termEventEmitter.filters.TermRepoServicerInitialized(
        null,
        null,
        null,
        null,
        null,
        null,
      );

    const termRepoServicerIntializedEvents = await termEventEmitter.queryFilter(
      servicerInitializedFilter,
    );

    expect(termRepoServicerIntializedEvents.length).to.equal(1);

    // approve token transferring
    await fungibleToken1
      .connect(wallet1)
      .approve(termRepoLocker.address, "250000000");
    await fungibleToken1
      .connect(wallet2)
      .approve(termRepoLocker.address, "250000000");
    await fungibleToken2
      .connect(wallet1)
      .approve(termRepoLocker.address, "300000000");
    await fungibleToken2
      .connect(wallet2)
      .approve(termRepoLocker.address, "300000000");
    await fungibleToken2
      .connect(wallet3)
      .approve(termRepoLocker.address, "300000000");
    await fungibleToken3
      .connect(wallet1)
      .approve(termRepoLocker.address, "300000000");
    await fungibleToken3
      .connect(wallet2)
      .approve(termRepoLocker.address, "300000000");
    await fungibleToken3
      .connect(wallet3)
      .approve(termRepoLocker.address, "300000000");
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
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
            BigNumber.from("200000000000000000"),
            BigNumber.from("50000000000000000"),
            BigNumber.from("5000000000000000"),
            ethers.constants.AddressZero,
            [
              {
                tokenAddress: fungibleToken1.address,
                initialCollateralRatio: "2000000000000000000",
                maintenanceRatio: "1500000000000000000",
                liquidatedDamage: "1",
              },
            ],
            termEventEmitter.address,
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
            BigNumber.from("200000000000000000"),
            ethers.constants.AddressZero,
            termController.address,
            termEventEmitter.address,
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
            BigNumber.from("200000000000000000"),
            BigNumber.from("50000000000000000"),
            BigNumber.from("5000000000000000"),
            fungibleToken3.address,
            [
              {
                tokenAddress: fungibleToken1.address,
                initialCollateralRatio: "2000000000000000000",
                maintenanceRatio: "1500000000000000000",
                liquidatedDamage: "0",
              },
            ],
            termEventEmitter.address,
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
        .withArgs(termRepoLocker.address, wallet1.address);

      await expect(
        termRepoLocker.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
    it("servicer upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoServicer.connect(devopsMultisig).upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(termRepoServicer.address, wallet1.address);

      await expect(
        termRepoServicer.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
    it("collateral manager upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoCollateralManager
          .connect(devopsMultisig)
          .upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(termRepoCollateralManager.address, wallet1.address);

      await expect(
        termRepoCollateralManager.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
  });

  describe("termRepoLocker tests", () => {
    it("all termRepoLocker functions revert if not called by termManager", async () => {
      await expect(
        termRepoLocker.transferTokenFromWallet(
          wallet1.address,
          fungibleToken1.address,
          15,
        ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x250b76734a070a69c7b3930477dd35007ad9c9d0952e97903fdafb2db6980537`,
      );

      await expect(
        termRepoLocker.transferTokenToWallet(
          wallet1.address,
          fungibleToken1.address,
          15,
        ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x250b76734a070a69c7b3930477dd35007ad9c9d0952e97903fdafb2db6980537`,
      );
    });
    it("all termRepoLocker transfers revert if transfers paused, and resume when unpaused", async () => {
      // pausing reverts when not called by the admin
      await expect(
        termRepoLocker.connect(wallet2).pauseTransfers(),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
      );

      await expect(termRepoLocker.connect(adminWallet).pauseTransfers())
        .to.emit(termEventEmitter, "TermRepoLockerTransfersPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet1.address,
            fungibleToken1.address,
            "15000000",
          ),
      ).to.be.revertedWithCustomError(
        termRepoLocker,
        "TermRepoLockerTransfersPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoLocker.connect(wallet2).unpauseTransfers(),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
      );

      await expect(termRepoLocker.connect(adminWallet).unpauseTransfers())
        .to.emit(termEventEmitter, "TermRepoLockerTransfersUnpaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .auctionLockCollateral(
            wallet1.address,
            fungibleToken1.address,
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
          .auctionLockCollateral(wallet2.address, fungibleToken2.address, 50),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x6e14a979b95b01beecd617807f3738f4e067938da99755b16afdcf7148d313b7`,
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .auctionUnlockCollateral(wallet2.address, fungibleToken2.address, 50),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x6e14a979b95b01beecd617807f3738f4e067938da99755b16afdcf7148d313b7`,
      );

      await expect(
        termRepoServicer.connect(wallet1).lockOfferAmount(wallet1.address, 15),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x6e14a979b95b01beecd617807f3738f4e067938da99755b16afdcf7148d313b7`,
      );

      await expect(
        termRepoServicer
          .connect(wallet1)
          .fulfillOffer(wallet1.address, 15, 20, getBytesHash("offer-1")),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x1d693f62a755e2b3c6494da41af454605b9006057cb3c79b6adda1378f2a50a7`,
      );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .fulfillBid(
            wallet2.address,
            15,
            20,
            [fungibleToken2.address],
            ["15000000"],
            "1000000000000000000",
          ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x1d693f62a755e2b3c6494da41af454605b9006057cb3c79b6adda1378f2a50a7`,
      );
    });
  });

  describe("collateral ledger balances", () => {
    it("initializes with zero balance for collateral", async () => {
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "15000000",
      );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      // unlocking collateral after maturation period completes (maturation timestamp is deployment block timestamp)
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionUnlockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "14000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet1.address,
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "1000000",
      );
    });
    it("revert external unlocking if borrow balance is 0", async function () {
      // locking collateral

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "15000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet1)
          .externalUnlockCollateral(fungibleToken1.address, "15000000"),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        `ZeroCollateralBalance`,
      );

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "15000000",
      );

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60,
      ]);

      // unlocking collateral after maturation period completes (maturation timestamp is deployment block timestamp)
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionUnlockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "14000000",
        );

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "1000000",
      );
    });

    it("reopening to another auction locking and unlocking collateral updates balance", async function () {
      // locking collateral
      await expect(
        termRepoCollateralManager.connect(wallet2).reopenToNewAuction({
          auction: anotherAuction.address,
          termAuctionBidLocker: anotherAuctionBidLocker.address,
          termAuctionOfferLocker: anotherAuctionOfferLocker.address,
        }),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
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
          termRepoCollateralManager.address,
          anotherAuctionBidLocker.address,
        );

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "235000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "15000000",
      );

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionUnlockCollateral(
          wallet1.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(await fungibleToken1.balanceOf(wallet1.address)).to.equal(
        "249000000",
      );
      expect(await fungibleToken1.balanceOf(termRepoLocker.address)).to.equal(
        "1000000",
      );
    });
  });
  describe("locked offer ledger balances", () => {
    it("locking and unlocking loan offers updates balance", async function () {
      // locking loan offer
      expect(
        await termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, "15000000"),
      )
        .to.emit(termRepoServicer, "OfferLockedByServicer")
        .withArgs(termIdHashed, wallet1.address, "15000000");

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "285000000",
      );
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        "15000000",
      );

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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        "15000000",
      );
    });
  });
  describe("making collateralized loans", () => {
    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with full redemption.", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
            [fungibleToken2.address],
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
          fungibleToken2.address,
          "15000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("15000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        0,
      );

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

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
            [fungibleToken2.address],
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

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          processed: false,
        });
      await expect(
        termRepoServicer
          .connect(wallet2)
          .submitRepurchasePayment(ethers.constants.MaxUint256),
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

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          processed: true,
        });

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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        "20000000",
      );
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal(0);
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
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

    it("valid loan (with protocol loan share), repay and redeem (with invalid redeem in between) with partial redemption due to low termRepoLocker balance.", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
            [fungibleToken2.address],
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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        0,
      );

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

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

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          locked: false,
          processed: false,
        });
      await expect(
        termRepoServicer.connect(wallet2).submitRepurchasePayment("20000000"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "RepurchaseAmountTooHigh",
      );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("10000000");

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "2000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          locked: true,
          processed: true,
        });

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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        "20000000",
      );
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal(0);
      expect(await fungibleToken2.balanceOf(wallet2.address)).to.equal(
        "300000000",
      );

      await network.provider.send("evm_increaseTime", [60 * 60 * 10]);

      termRepoServicer.setPurchaseCurrencyHeld("19999999");

      await expect(
        termRepoServicer.redeemTermRepoTokens(wallet1.address, "20000000"),
      )
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed")
        .withArgs(termIdHashed, wallet1.address, "19999999", 0);

      expect(await fungibleToken3.balanceOf(wallet1.address)).to.equal(
        "304999999",
      );
    });
    it("valid loan (with protocol loan share), half repay and redeem with half redemption", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "10500000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
            [fungibleToken2.address],
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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        0,
      );

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

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
          fungibleToken2.address,
          "10500000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "7500000");

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, "7500000");

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
            [fungibleToken2.address],
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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        0,
      );

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

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
        wallet3fun3Balance.add(5000000 - 1 - 10000000), // includes liq repayment
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
          termRepoServicer.address,
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
          termRepoCollateralManager.address,
          anotherAuctionBidLocker.address,
        );

      await termRepoCollateralManager
        .connect(anotherAuctionBidLocker)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "15000000",
        );

      await termRepoServicer
        .connect(anotherAuctionOfferLocker)
        .lockOfferAmount(wallet1.address, "15000000");

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
            [fungibleToken2.address],
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
      expect(await fungibleToken3.balanceOf(termRepoLocker.address)).to.equal(
        0,
      );

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");

      await fungibleToken1
        .connect(wallet2)
        .approve(termRepoLocker.address, "10000000");
    });

    it("valid create position loan and full collapse around a standing rollover", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, "15000000");

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
          [fungibleToken1.address],
          ["15000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "NoMintOpenExposureAccess",
      );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .grantMintExposureAccess(wallet2.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
      );

      await expect(
        termRepoServicer
          .connect(adminWallet)
          .grantMintExposureAccess(wallet2.address),
      )
        .to.emit(termEventEmitter, "MintExposureAccessGranted")
        .withArgs(termIdHashed, wallet2.address);

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
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17944445",
          "20000000",
          "2055555",
        )
        .to.emit(termEventEmitter, "TermRepoTokenMint")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17944445",
          "2055555",
          "20000000",
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.eq(
        "37944445",
      );
      expect(await testTermRepoToken.balanceOf(treasuryWallet.address)).to.eq(
        "2055555",
      );

      // revert if attempt to collapse with no borrow balance
      await expect(
        termRepoServicer.connect(wallet3).burnCollapseExposure("37944445"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      const user: SignerWithAddress = wallet2;

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "5000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          locked: false,
          processed: false,
        });

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("37944445"),
      )
        .to.emit(termEventEmitter, "BurnCollapseExposure")
        .withArgs(termIdHashed, wallet2.address, "15000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "22944445",
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
    it("valid create position loan and full collapse around a fulfilled rollover", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, "15000000");

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
          [fungibleToken1.address],
          ["15000000"],
          "1000000000000000000",
        );

      let user: SignerWithAddress = wallet2;

      await expect(
        termRepoServicer
          .connect(user)
          .mintOpenExposure("20000000", ["0", "50000000"]),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "NoMintOpenExposureAccess",
      );

      await expect(
        termRepoServicer
          .connect(wallet2)
          .grantMintExposureAccess(wallet2.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
      );

      await termRepoServicer
        .connect(adminWallet)
        .grantMintExposureAccess(wallet2.address);

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
        .to.emit(termEventEmitter, "BidFulfilled")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17944445",
          "20000000",
          "2055555",
        )
        .to.emit(termEventEmitter, "TermRepoTokenMint")
        .withArgs(
          termIdHashed,
          wallet2.address,
          "17944445",
          "2055555",
          "20000000",
        );

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.eq("20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.eq(
        "37944445",
      );
      expect(await testTermRepoToken.balanceOf(treasuryWallet.address)).to.eq(
        "2055555",
      );

      // revert if attempt to collapse with no borrow balance
      await expect(
        termRepoServicer.connect(wallet3).burnCollapseExposure("37944445"),
      ).to.be.revertedWithCustomError(
        termRepoServicer,
        "ZeroBorrowerRepurchaseObligation",
      );

      user = wallet2;

      termRepoRolloverManager.getRolloverInstructions
        .whenCalledWith(wallet2.address)
        .returns({
          rolloverAuctionBidLocker: wallet3.address,
          rolloverAmount: "5000000",
          rolloverBidPriceHash: ethers.constants.HashZero,
          locked: false,
          processed: true,
        });

      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("37944445"),
      )
        .to.emit(termEventEmitter, "BurnCollapseExposure")
        .withArgs(termIdHashed, wallet2.address, "20000000");

      expect(await testTermRepoToken.balanceOf(wallet2.address)).to.equal(
        "17944445",
      );
      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal(0);
    });

    it("valid loan (with protocol loan share) after term maturity and partial collapse", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "15000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, "15000000");

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
            [fungibleToken2.address],
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
            [fungibleToken1.address],
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
      await expect(
        termRepoServicer.connect(user).burnCollapseExposure("10000000"),
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
          fungibleToken2.address,
          "15000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken1.address,
          "15000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, "15000000");

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
          [fungibleToken2.address],
          ["15000000"],
          "1000000000000000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "15000000",
          "20000000",
          [fungibleToken1.address],
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
          fungibleToken2.address,
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          [fungibleToken2.address],
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
  });
  describe("borrower collateral unlocking/locking after taking loan", () => {
    it("loan and valid additional collateral locking", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          [fungibleToken2.address],
          ["150000000"],
          "1000000000000000000",
        );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(fungibleToken2.address, "5000000"),
      )
        .to.emit(termEventEmitter, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken2.address,
          "5000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("155000000");
    });
    it("zero collateral balance reverts collateral unlocking", async () => {
      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalUnlockCollateral(fungibleToken1.address, "0"),
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
          fungibleToken2.address,
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "0",
          "1",
          [fungibleToken2.address],
          ["15000000"],
          "1",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          .externalUnlockCollateral(fungibleToken2.address, "150000001"),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "UnlockAmountGreaterThanCollateralBalance",
      );

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(fungibleToken3.address, "5000000"),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralTokenNotAllowed`,
        )
        .withArgs(fungibleToken3.address);

      await network.provider.send("evm_increaseTime", [
        60 * 60 * 24 * 365 + 60 * 60 * 10,
      ]);

      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalLockCollateral(fungibleToken2.address, "5000000"),
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
          fungibleToken2.address,
          "50000000",
        );

      await expect(
        termRepoServicer
          .connect(termAuctionOfferLockerAddress)
          .lockOfferAmount(wallet1.address, "15000000"),
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
          .lockOfferAmount(wallet1.address, "5000000"),
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
          [fungibleToken2.address],
          ["50000000"],
          "1000000000000000000",
        );

      const user = wallet2;

      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(fungibleToken2.address, "5000000"),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken2.address,
          "5000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("45000000");
    });
    it("external unlock collateral reverts when not called by borrower", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          [fungibleToken2.address],
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
          fungibleToken2.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          [fungibleToken2.address],
          ["50000000"],
          "1000000000000000000",
        );
      const user = wallet2;
      await expect(
        termRepoCollateralManager
          .connect(wallet2)
          .externalUnlockCollateral(fungibleToken3.address, "5000000"),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralTokenNotAllowed`,
        )
        .withArgs(fungibleToken3.address);

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365]);

      await network.provider.send("evm_increaseTime", [60 * 60 * 8]);
      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(fungibleToken2.address, "100000"),
      ).to.be.revertedWithCustomError(
        termRepoCollateralManager,
        "CollateralWithdrawalClosed",
      );

      await network.provider.send("evm_increaseTime", [60 * 15]);
      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(fungibleToken2.address, "100000"),
      )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken2.address,
          "100000",
        );
    });
    it("external unlock collateral reverts when collateral falls below maintenance ratio", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "15000000");

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
          [fungibleToken2.address],
          ["50000000"],
          "1000000000000000000",
        );

      const user = wallet2;

      await expect(
        termRepoCollateralManager
          .connect(user)
          .externalUnlockCollateral(fungibleToken2.address, "20000001"),
      )
        .to.be.revertedWithCustomError(
          termRepoCollateralManager,
          `CollateralBelowMaintenanceRatios`,
        )
        .withArgs(wallet2.address, fungibleToken2.address);
    });
  });
  describe("borrower collateral liquidations", () => {
    it("valid batch liquidation", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
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
          fungibleToken1.address,
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
          fungibleToken2.address,
        ),
      ).to.equal("39500000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
        ),
      ).to.equal("4750000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "30000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
          ["30000000", "50000000"],
          "1000000000000000000",
        );

      // pausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).pauseLiquidations(),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
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
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken2.address],
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
          .batchLiquidation(wallet2.address, [ethers.constants.MaxUint256, 0]),
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
        .withArgs(fungibleToken2.address);

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
          fungibleToken2.address,
          "150000000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken2.address],
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
          fungibleToken2.address,
          "100000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000");

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
          [fungibleToken2.address],
          ["100000"],
          "10000",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
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
        .auctionLockCollateral(wallet2.address, fungibleToken1.address, "290");

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "300");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillOffer(wallet1.address, "300", "400", getBytesHash("offer-1"));

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "300",
          "400",
          [fungibleToken1.address],
          ["290"],
          "100",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
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
          fungibleToken1.address,
        ),
      ).to.eq("0");
    });

    it("revert batch liquidations of borrowers with no balance", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
          "17000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "20000000");

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
          [fungibleToken1.address],
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
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
          fungibleToken1.address,
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
          fungibleToken2.address,
        ),
      ).to.equal("39500000");
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
        ),
      ).to.equal("4750000");
      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.eq("4750000");

      expect(
        (await fungibleToken2.balanceOf(wallet1.address)).sub(
          f2W1BalanceBefore,
        ),
      ).to.equal("8500000");
      expect(await fungibleToken2.balanceOf(reserveAddress.address)).to.equal(
        "2000000",
      );
      expect(
        (await fungibleToken1.balanceOf(wallet1.address)).sub(
          f1W1BalanceBefore,
        ),
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "30000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
          ["30000000", "50000000"],
          "1000000000000000000",
        );

      // pausing reverts when not called by the admin
      await expect(
        termRepoCollateralManager.connect(wallet2).pauseLiquidations(),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
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
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
          "10000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          fungibleToken2.address,
          "10000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "90000001");

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
          [fungibleToken2.address],
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
          [fungibleToken2.address],
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
          .batchLiquidationWithRepoToken(wallet2.address, [
            ethers.constants.MaxUint256,
            0,
          ]),
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
        .withArgs(fungibleToken2.address);

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
          fungibleToken2.address,
          "150000000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "150000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken2.address],
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
          fungibleToken2.address,
          "100000",
        );

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          fungibleToken2.address,
          "100000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "90000");

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
          [fungibleToken2.address],
          ["100000"],
          "10000",
        );
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "10000",
          "20000",
          [fungibleToken2.address],
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
        .auctionLockCollateral(wallet2.address, fungibleToken1.address, "290");

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(wallet3.address, fungibleToken2.address, "2000");

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "1300");

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
          [fungibleToken1.address],
          ["290"],
          "100",
        );

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "1000",
          "1400",
          [fungibleToken2.address],
          ["2000"],
          "100",
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
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
          fungibleToken1.address,
        ),
      ).to.eq("0");
    });

    it("revert batch liquidations with repo token of borrowers with no balance", async function () {
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
          "17000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "20000000");

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
          [fungibleToken1.address],
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
          fungibleToken2.address,
          "150000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "20000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
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
          fungibleToken1.address,
          "5250000",
          "1000000",
          true,
        );

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.eq("44750000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
        ),
      ).to.eq("139500000");

      expect(
        await termRepoServicer.getBorrowerRepurchaseObligation(wallet2.address),
      ).to.equal("10000000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("139500000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
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
          fungibleToken1.address,
        ),
      ).to.eq(0);

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
        ),
      ).to.eq(0);

      await termRepoCollateralManager
        .connect(wallet2)
        .externalUnlockCollateral(fungibleToken2.address, "139500000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
        ),
      ).to.eq(0);
    });

    it("default liquidations reverted when paused, and succeed once unpaused", async function () {
      // borrower locks collateral
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "20000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          fungibleToken2.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "40000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet1.address, "80000000");

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
          [fungibleToken1.address, fungibleToken2.address],
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
          ethers.constants.MaxUint256,
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
        .withArgs(fungibleToken1.address);

      // TODO: add test for excessive repayment
    });
  });
  describe("rollover auction functions", () => {
    beforeEach(async () => {
      wallet3.sendTransaction({
        to: termRepoRolloverManager.address,
        value: parseEther("1"),
      });

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [termRepoRolloverManager.address],
      });
    });
    it("partially unlock rollover collateral to address", async function () {
      const termRepoRolloverManagerSigner = await ethers.getSigner(
        termRepoRolloverManager.address,
      );

      await expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x6e3cc031d23d7153f72e87cbfd113a0351c60d8ce52b8a31c944d543a384b7c9`,
      );
      await termRepoCollateralManager
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "40000000",
        );
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, "50000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "50000",
          "60000",
          [fungibleToken1.address, fungibleToken2.address],
          ["50000000", "40000000"],
          "100000000000",
        );

      expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x6e14a979b95b01beecd617807f3738f4e067938da99755b16afdcf7148d313b7`,
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
          fungibleToken1.address,
          "25000000",
        )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken2.address,
          "20000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
        ),
      ).to.equal("25000000");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("20000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.equal("25000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
        ),
      ).to.equal("20000000");
    });
    it("unlock all rollover collateral to address", async function () {
      const termRepoRolloverManagerSigner = await ethers.getSigner(
        termRepoRolloverManager.address,
      );

      await termRepoCollateralManager
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet2.address,
          fungibleToken2.address,
          "40000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, "50000");

      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet2.address,
          "50000",
          "6000",
          [fungibleToken1.address, fungibleToken2.address],
          ["50000000", "40000000"],
          "100000000000",
        );

      await expect(
        termRepoCollateralManager.approveRolloverAuction(
          anotherAuction.address,
        ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x6e3cc031d23d7153f72e87cbfd113a0351c60d8ce52b8a31c944d543a384b7c9`,
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
          fungibleToken1.address,
          "50000000",
        )
        .to.emit(termEventEmitter, "CollateralUnlocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken2.address,
          "40000000",
        );

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken2.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.equal("0");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken2.address,
        ),
      ).to.equal("0");
    });
    it("accept rollover collateral from auction", async function () {
      expect(
        await termRepoCollateralManager
          .connect(termAuctionBidLockerAddress)
          .acceptRolloverCollateral(
            wallet2.address,
            fungibleToken1.address,
            "50000000",
          ),
      )
        .to.emit(termRepoCollateralManager, "CollateralLocked")
        .withArgs(
          termIdHashed,
          wallet2.address,
          fungibleToken1.address,
          "50000000",
        );
      expect(
        await termRepoCollateralManager.getCollateralBalance(
          wallet2.address,
          fungibleToken1.address,
        ),
      ).to.equal("50000000");

      expect(
        await termRepoCollateralManager.getEncumberedCollateralBalances(
          fungibleToken1.address,
        ),
      ).to.equal("50000000");
    });

    it("open rollover position from past term", async function () {
      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet2.address, "600000");
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
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x1d693f62a755e2b3c6494da41af454605b9006057cb3c79b6adda1378f2a50a7`,
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
        termRepoRolloverManager.address,
      );

      await expect(
        termRepoServicer.approveRolloverAuction(anotherAuction.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x6e3cc031d23d7153f72e87cbfd113a0351c60d8ce52b8a31c944d543a384b7c9`,
      );
      await termRepoServicer
        .connect(termRepoRolloverManagerSigner)
        .approveRolloverAuction(anotherAuction.address);

      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet3.address,
          fungibleToken2.address,
          "1000000",
        );
      await termRepoCollateralManager
        .connect(termAuctionBidLockerAddress)
        .auctionLockCollateral(
          wallet1.address,
          fungibleToken2.address,
          "1000000",
        );

      await termRepoServicer
        .connect(termAuctionOfferLockerAddress)
        .lockOfferAmount(wallet3.address, "590000");
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet1.address,
          "590000",
          "600000",
          [fungibleToken2.address],
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
        .lockOfferAmount(wallet1.address, "590000");
      await termRepoServicer
        .connect(termAuctionAddress)
        .fulfillBid(
          wallet3.address,
          "590000",
          "600000",
          [fungibleToken2.address],
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
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xf4b6b486426e3c004413defb7013cd482f29189a98e074f1c202b2ac26536bb2`,
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
