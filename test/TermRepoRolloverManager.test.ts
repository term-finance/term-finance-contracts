/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  TermAuctionBidLocker,
  TermRepoCollateralManager,
  TermRepoCollateralManager__factory,
  TermController,
  TermController__factory,
  TermEventEmitter,
  TermRepoServicer,
  TermRepoServicer__factory,
  TestTermRepoRolloverManager,
  TermAuction,
  TermAuctionBidLocker__factory,
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TermAuction__factory,
} from "../typechain-types";
import { ZeroAddress, ZeroHash, solidityPackedKeccak256 } from "ethers";
import {
  deployMockContract,
  MockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";

describe("TermRepoRollover Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let auction: SignerWithAddress;

  let servicerSigner: SignerWithAddress;

  let purchaseTokenAddress: SignerWithAddress;
  let collateralToken1: MockContract<ERC20Upgradeable>;
  let collateralToken2: MockContract<ERC20Upgradeable>;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let termDiamond: SignerWithAddress

  let termRepoRolloverManager: TestTermRepoRolloverManager;

  let mockTermRepoServicer: MockContract<TermRepoServicer>;
  let mockFutureTermRepoServicer: MockContract<TermRepoServicer>;

  let mockTermRepoCollateralManager: MockContract<TermRepoCollateralManager> &
    TermRepoCollateralManager;
  let mockTermController: MockContract<TermController>;
  let termEventEmitter: TermEventEmitter;

  let mockAuctionBidLocker: MockContract<TermAuctionBidLocker>;
  let mockAuction: MockContract<TermAuction>;

  let termIdHashed: string;

  let maturationTimestampOneYear: number;

  let snapshotId: any;
  let expectedVersion: string;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");

    upgrades.silenceWarnings();
    [
      wallet1,
      wallet2,
      wallet3,
      auction,
      servicerSigner, // wallet to impersonate term repo servicer for fulfill test
      purchaseTokenAddress,
      termInitializer,
      devopsMultisig,
      adminWallet,
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
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    const TermRepoRolloverManager = await ethers.getContractFactory(
      "TestTermRepoRolloverManager",
    );

    // Yet to Mature Term Management
    maturationTimestampOneYear =
      (await ethers.provider.getBlock("latest"))!.timestamp +
      60 * 60 * 24 * 365;

    const termIdString = maturationTimestampOneYear.toString() + "_ft3_ft1-ft2";

    termIdHashed = solidityPackedKeccak256(["string"], [termIdString]);

    mockTermRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );
    mockFutureTermRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );
    mockTermRepoCollateralManager =
      await deployMockContract<TermRepoCollateralManager>(
        wallet1,
        TermRepoCollateralManager__factory.abi,
      );
    mockTermController = await deployMockContract<TermController>(
      wallet1,
      TermController__factory.abi,
    );
    mockAuctionBidLocker = await deployMockContract<TermAuctionBidLocker>(
      wallet1,
      TermAuctionBidLocker__factory.abi,
    );
    mockAuction = await deployMockContract<TermAuction>(
      wallet1,
      TermAuction__factory.abi,
    );
    collateralToken1 = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    collateralToken2 = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );

    await mockTermRepoServicer.mock.maturityTimestamp.returns(
      BigInt(maturationTimestampOneYear),
    );

    await mockTermController.mock.termContractsPaused.returns(false);

    termRepoRolloverManager = (await upgrades.deployProxy(
      TermRepoRolloverManager,
      [
        termIdString,
        await mockTermRepoServicer.getAddress(),
        await mockTermRepoCollateralManager.getAddress(),
        await mockTermController.getAddress(),
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as unknown as TestTermRepoRolloverManager;
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoRolloverManager.getAddress());
    await expect(
      termRepoRolloverManager
        .connect(wallet2)
        .pairTermContracts(
          await mockTermRepoServicer.getAddress(),
          termDiamond.address,
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoRolloverManager,
      "AccessControlUnauthorizedAccount",
    );
    await termRepoRolloverManager
      .connect(termInitializer)
      .pairTermContracts(
        await mockTermRepoServicer.getAddress(),
        termDiamond.address,
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );
    await expect(
      termRepoRolloverManager
        .connect(termInitializer)
        .pairTermContracts(
          await mockTermRepoServicer.getAddress(),
          termDiamond.address,
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoRolloverManager,
      "AlreadyTermContractPaired",
    );
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("TermRepoRolloverManager Upgrades", async () => {
    it("TermRepoRolloverManager upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoRolloverManager
          .connect(devopsMultisig)
          .upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(await termRepoRolloverManager.getAddress(), wallet1.address);

      await expect(
        termRepoRolloverManager.connect(wallet2).upgrade(wallet2.address),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Invalid Signature Reverts", async () => {
    it("elections and cancellations fail if signatures revert", async () => {
      await mockTermController.mock.isTermDeployed.returns(true);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(1n)
        .returns(await collateralToken2.getAddress());

      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken1.getAddress())
        .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken2.getAddress())
        .returns(true);

      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );

      await expect(
        termRepoRolloverManager.connect(wallet3).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.reverted;

      await expect(termRepoRolloverManager.connect(wallet3).cancelRollover()).to
        .be.reverted;
    });
  });

  describe("Rollover Term Approval Tests (isTermDeployed == false)", async () => {
    beforeEach(async () => {
      await mockTermController.mock.isTermDeployed.returns(false);
      await mockTermController.mock.isFactoryDeployed.returns(false);
    });

    it("Rollover Term not approved, invalid auction contracts", async () => {
      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        await collateralToken1.getAddress(),
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(1n)
        .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken1.getAddress())
        .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken2.getAddress())
        .returns(false);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `NotTermContract`,
        )
        .withArgs(await mockAuctionBidLocker.getAddress());
    });
  });

  describe("Rollover Term Approval tests", async () => {
    beforeEach(async () => {
      await mockTermController.mock.isTermDeployed.returns(true);
    });

    it("Rollover Term not approved, invalid auction contracts (DifferentPurchaseToken)", async () => {
      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        await collateralToken1.getAddress(),
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(1n)
        .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken1.getAddress())
        .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken2.getAddress())
        .returns(false);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `DifferentPurchaseToken`,
        )
        .withArgs(
          purchaseTokenAddress.address,
          await collateralToken1.getAddress(),
        );
    });

    it("Rollover Term not approved, invalid auction contracts", async () => {
      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2n,
      );
      // await (mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(0n)
      //   .returns(await collateralToken1.getAddress()));
      await mockTermRepoCollateralManager.mock.collateralTokens
        // .withArgs(1n)
        .returns(await collateralToken2.getAddress());
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken1.getAddress())
      //   .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken2.getAddress())
        .returns(false);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `CollateralTokenNotSupported`,
        )
        .withArgs(await collateralToken2.getAddress());
    });

    it("Rollover Term approval reverts if endOfRepurchaseWindow reached", async () => {
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );

      // Move time past endOfRepurchaseWindow (maturity + 15 hours)
      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 + 60 * 60 * 16]);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "EndOfRepurchaseWindowReached",
      );
    });

    it("Rollover Term approval allowed after maturity but before endOfRepurchaseWindow", async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .returns(await collateralToken1.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        .returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      // Move time past maturity but before endOfRepurchaseWindow (maturity + 10 hours)
      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 + 60 * 60 * 10]);

      // Should succeed
      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      ).to.not.be.reverted;
    });

    it("Rollover Term approved only if called by admin role", async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        // .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(1n)
      //   .returns(await collateralToken2.getAddress());

      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken1.getAddress())
        .returns(true);
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken2.getAddress())
      //   .returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      await expect(
        termRepoRolloverManager
          .connect(wallet2)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AccessControlUnauthorizedAccount",
      );

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      )
        .to.emit(termEventEmitter, "RolloverTermApproved")
        .withArgs(termIdHashed, ZeroHash);
    });

    it("Rollover Term not approved, auction ends after repayment", async () => {
      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 6,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(1n)
        .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken1.getAddress())
        .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken2.getAddress())
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AuctionEndsAfterRepayment",
      );
    });

    it("Rollover Term not approved, auction ends before maturity", async () => {
      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear - 60 * 60 * 2,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      await mockTermRepoCollateralManager.mock.collateralTokens
        .withArgs(1n)
        .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken1.getAddress())
        .returns(true);
      await mockAuctionBidLocker.mock.collateralTokens
        .withArgs(await collateralToken2.getAddress())
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AuctionEndsBeforeMaturity",
      );
    });
    it("Rollover Term  approved and then revoked", async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2n,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens
        // .withArgs(0n)
        .returns(await collateralToken1.getAddress());
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(1n)
      //   .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken1.getAddress())
        .returns(true);
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken2.getAddress())
      //   .returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(await mockAuctionBidLocker.getAddress()),
      )
        .to.emit(termEventEmitter, "RolloverTermApproved")
        .withArgs(termIdHashed, ZeroHash);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .revokeRolloverApproval(await mockAuctionBidLocker.getAddress()),
      )
        .to.emit(termEventEmitter, "RolloverTermApprovalRevoked")
        .withArgs(termIdHashed, ZeroHash);
    });
  });
  describe("Rollover Term Borrows (No borrower obligation)", async () => {
    beforeEach(async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2n,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens.returns(
        await collateralToken1.getAddress(),
      );
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(0n)
      //   .returns(await collateralToken1.getAddress());
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(1n)
      //   .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken1.getAddress())
        .returns(true);
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken2.getAddress())
      //   .returns(true);

      await mockAuctionBidLocker.mock.termRepoServicer.returns(
        await mockFutureTermRepoServicer.getAddress(),
      );
      await mockFutureTermRepoServicer.mock.servicingFee.returns(
        "20000000000000000",
      );

      await mockTermRepoServicer.mock.getBorrowerRepurchaseObligation
        // .withArgs(wallet3.address)
        .returns(0n);
      await mockTermController.mock.isTermDeployed.returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      await termRepoRolloverManager
        .connect(adminWallet)
        .approveRolloverAuction(await mockAuctionBidLocker.getAddress());
    });
    it("Rollover Term Election reverted if borrow balance is zero", async () => {
      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: wallet1.address,
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        `ZeroBorrowerRepurchaseObligation`,
      );

      await expect(
        termRepoRolloverManager.connect(wallet1).cancelRollover(),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        `ZeroBorrowerRepurchaseObligation`,
      );
    });
  });

  describe("Rollover Term Borrows", async () => {
    beforeEach(async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2n,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens.returns(
        await collateralToken1.getAddress(),
      );
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(0n)
      //   .returns(await collateralToken1.getAddress());
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(1n)
      //   .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken1.getAddress())
        .returns(true);
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken2.getAddress())
      //   .returns(true);

      await mockAuctionBidLocker.mock.termRepoServicer.returns(
        await mockFutureTermRepoServicer.getAddress(),
      );
      await mockFutureTermRepoServicer.mock.servicingFee.returns(
        "20000000000000000",
      );

      await mockTermRepoServicer.mock.getBorrowerRepurchaseObligation
        // .withArgs(wallet3.address)
        .returns(90000000000n);
      await mockTermController.mock.isTermDeployed.returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      await termRepoRolloverManager
        .connect(adminWallet)
        .approveRolloverAuction(await mockAuctionBidLocker.getAddress());
    });

    it("Rollover Term Election reverted if address is not approved", async () => {
      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: wallet1.address,
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `RolloverAddressNotApproved`,
        )
        .withArgs(wallet1.address);
    });
    it("Rollover Term Election reverted if rolloverAmount is zero", async () => {
      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "0",
          rolloverBidPriceHash,
        }),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `InvalidParameters`,
        )
        .withArgs("Rollover amount cannot be 0");
    });
    it("Rollover Term Elections and rollover processed, blocking further rollovers", async () => {
      await mockTermRepoCollateralManager.mock.getCollateralBalances
        // .withArgs(wallet1.address)
        .returns([await collateralToken1.getAddress()], ["10000000000"]);
      // await mockTermRepoCollateralManager.mock.getCollateralBalances
      //   .withArgs(wallet2.address)
      //   .returns([await collateralToken2.getAddress()], ["10000000000"]);
      await mockAuctionBidLocker.mock.lockRolloverBid.returns();
      await mockAuctionBidLocker.mock.dayCountFractionMantissa.returns(
        10n ** 18n,
      );
      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).cancelRollover(),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        `NoRolloverToCancel`,
      );

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ZeroHash,
          wallet1.address,
          await mockAuctionBidLocker.getAddress(),
          "10000000000",
          rolloverBidPriceHash,
        );

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "20000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ZeroHash,
          wallet1.address,
          await mockAuctionBidLocker.getAddress(),
          "20000000000",
          rolloverBidPriceHash,
        );
      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        await mockAuctionBidLocker.getAddress(),
        BigInt("20000000000"),
        rolloverBidPriceHash,
        false,
      ]);
      await expect(
        termRepoRolloverManager.connect(wallet2).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "30000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ZeroHash,
          wallet2.address,
          await mockAuctionBidLocker.getAddress(),
          "30000000000",
          rolloverBidPriceHash,
        );
      await expect(termRepoRolloverManager.connect(wallet2).cancelRollover())
        .to.emit(termEventEmitter, "RolloverCancellation")
        .withArgs(termIdHashed, wallet2.address);
      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet2.address),
      ).to.deep.equal([ZeroAddress, BigInt("0"), ZeroHash, false]);
      await expect(
        termRepoRolloverManager.connect(wallet2).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ZeroHash,
          wallet2.address,
          await mockAuctionBidLocker.getAddress(),
          "40000000000",
          rolloverBidPriceHash,
        );

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        await mockAuctionBidLocker.getAddress(),
        BigInt("20000000000"),
        rolloverBidPriceHash,
        false,
      ]);

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet2.address),
      ).to.deep.equal([
        await mockAuctionBidLocker.getAddress(),
        BigInt("40000000000"),
        rolloverBidPriceHash,
        false,
      ]);

      await termRepoRolloverManager
        .connect(termInitializer)
        .testRepairTermContracts(
          servicerSigner.address,
          await termEventEmitter.getAddress(),
        );

      await expect(
        termRepoRolloverManager.fulfillRollover(wallet1.address),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AccessControlUnauthorizedAccount",
      );

      await termRepoRolloverManager
        .connect(servicerSigner)
        .fulfillRollover(wallet1.address);

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        await mockAuctionBidLocker.getAddress(),
        BigInt("20000000000"),
        rolloverBidPriceHash,
        true,
      ]);

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "RolloverProcessedToTerm",
      );

      await expect(
        termRepoRolloverManager.connect(wallet1).cancelRollover(),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "RolloverProcessedToTerm",
      );

      // Move time past endOfRepurchaseWindow (maturity + 15 hours)
      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 366 + 60 * 60 * 16]);

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "EndOfRepurchaseWindowReached",
      );
    });

    it("electRollover allowed after maturity but before endOfRepurchaseWindow", async () => {
      // Set up mocks for successful rollover processing
      await mockTermRepoCollateralManager.mock.getCollateralBalances
        .returns([await collateralToken1.getAddress()], ["10000000000"]);
      await mockAuctionBidLocker.mock.lockRolloverBid.returns();
      await mockAuctionBidLocker.mock.dayCountFractionMantissa.returns(
        10n ** 18n,
      );

      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );

      // Move time past maturity but before endOfRepurchaseWindow (maturity + 10 hours) 
      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 365 + 60 * 60 * 10]);

      // Should succeed
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      ).to.not.be.reverted;
    });
  });

  describe("Rollover Term Borrows (BorrowerRepurchaseObligationInsufficient)", async () => {
    beforeEach(async () => {
      await mockAuctionBidLocker.mock.termRepoId.returns(ZeroHash);
      await mockAuctionBidLocker.mock.termAuctionId.returns(ZeroHash);

      await mockAuctionBidLocker.mock.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      await mockAuctionBidLocker.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );
      await mockTermRepoServicer.mock.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      await mockTermRepoServicer.mock.purchaseToken.returns(
        purchaseTokenAddress.address,
      );

      await mockTermRepoServicer.mock.approveRolloverAuction.returns();
      await mockTermRepoCollateralManager.mock.approveRolloverAuction.returns();

      await mockTermRepoCollateralManager.mock.numOfAcceptedCollateralTokens.returns(
        2n,
      );
      await mockTermRepoCollateralManager.mock.collateralTokens.returns(
        await collateralToken1.getAddress(),
      );
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(0n)
      //   .returns(await collateralToken1.getAddress());
      // await mockTermRepoCollateralManager.mock.collateralTokens
      //   .withArgs(1n)
      //   .returns(await collateralToken2.getAddress());
      await mockAuctionBidLocker.mock.collateralTokens
        // .withArgs(await collateralToken1.getAddress())
        .returns(true);
      // await mockAuctionBidLocker.mock.collateralTokens
      //   .withArgs(await collateralToken2.getAddress())
      //   .returns(true);

      await mockAuctionBidLocker.mock.termRepoServicer.returns(
        await mockFutureTermRepoServicer.getAddress(),
      );
      await mockFutureTermRepoServicer.mock.servicingFee.returns(
        "20000000000000000",
      );

      await mockTermRepoServicer.mock.getBorrowerRepurchaseObligation
        // .withArgs(wallet3.address)
        .returns(11000000000n);
      await mockTermController.mock.isTermDeployed.returns(true);
      await mockAuctionBidLocker.mock.termAuction.returns(
        await mockAuction.getAddress(),
      );

      await termRepoRolloverManager
        .connect(adminWallet)
        .approveRolloverAuction(await mockAuctionBidLocker.getAddress());
    });

    it("Election and then Rollover Fails due to borrow balance too low", async () => {
      const rolloverBidPriceHash = solidityPackedKeccak256(
        ["uint256"],
        ["100000000000"],
      );

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuctionBidLocker: await mockAuctionBidLocker.getAddress(),
          rolloverAmount: "12000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "BorrowerRepurchaseObligationInsufficient",
      );
    });
  });
  it("version returns the current contract version", async () => {
    expect(await termRepoRolloverManager.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
