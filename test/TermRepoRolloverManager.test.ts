/* eslint-disable camelcase */
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, constants } from "ethers";
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
} from "../typechain-types";

describe("TermRepoRollover Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let auction: SignerWithAddress;

  let servicerSigner: SignerWithAddress;

  let purchaseTokenAddress: SignerWithAddress;
  let collateralToken1: SignerWithAddress;
  let collateralToken2: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;

  let termRepoRolloverManager: TestTermRepoRolloverManager;

  let mockTermRepoServicer: MockContract<TermRepoServicer>;
  let mockFutureTermRepoServicer: MockContract<TermRepoServicer>;

  let mockTermRepoCollateralManager: MockContract<TermRepoCollateralManager>;
  let mockTermController: MockContract<TermController>;
  let termEventEmitter: TermEventEmitter;

  let mockAuctionBidLocker: FakeContract<TermAuctionBidLocker>;

  let termIdHashed: string;

  let maturationTimestampOneYear: number;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    upgrades.silenceWarnings();
    [
      wallet1,
      wallet2,
      wallet3,
      auction,
      servicerSigner, // wallet to impersonate term repo servicer for fulfill test
      purchaseTokenAddress,
      collateralToken1,
      collateralToken2,
      termInitializer,
      devopsMultisig,
      adminWallet,
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
      { kind: "uups" },
    )) as TermEventEmitter;

    const TermRepoRolloverManager = await ethers.getContractFactory(
      "TestTermRepoRolloverManager",
    );

    // Yet to Mature Term Management
    maturationTimestampOneYear =
      (await ethers.provider.getBlock("latest")).timestamp + 60 * 60 * 24 * 365;

    const termIdString = maturationTimestampOneYear.toString() + "_ft3_ft1-ft2";

    termIdHashed = ethers.utils.solidityKeccak256(["string"], [termIdString]);

    const mockTermRepoServicerFactory =
      await smock.mock<TermRepoServicer__factory>("TermRepoServicer");
    mockTermRepoServicer = await mockTermRepoServicerFactory.deploy();
    await mockTermRepoServicer.deployed();

    mockFutureTermRepoServicer = await mockTermRepoServicerFactory.deploy();
    await mockFutureTermRepoServicer.deployed();

    const mockTermRepoCollateralManagerFactory =
      await smock.mock<TermRepoCollateralManager__factory>(
        "TermRepoCollateralManager",
      );
    mockTermRepoCollateralManager =
      await mockTermRepoCollateralManagerFactory.deploy();
    await mockTermRepoCollateralManager.deployed();

    const mockTermControllerFactory =
      await smock.mock<TermController__factory>("TermController");
    mockTermController = await mockTermControllerFactory.deploy();
    await mockTermController.deployed();

    mockAuctionBidLocker = await smock.fake("TermAuctionBidLocker");

    termRepoRolloverManager = (await upgrades.deployProxy(
      TermRepoRolloverManager,
      [
        termIdString,
        mockTermRepoServicer.address,
        mockTermRepoCollateralManager.address,
        mockTermController.address,
        termInitializer.address,
      ],
      {
        kind: "uups",
      },
    )) as TestTermRepoRolloverManager;
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoRolloverManager.address);
    await expect(
      termRepoRolloverManager
        .connect(wallet2)
        .pairTermContracts(
          mockTermRepoServicer.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
    );
    await termRepoRolloverManager
      .connect(termInitializer)
      .pairTermContracts(
        mockTermRepoServicer.address,
        termEventEmitter.address,
        devopsMultisig.address,
        adminWallet.address,
      );
    await expect(
      termRepoRolloverManager
        .connect(termInitializer)
        .pairTermContracts(
          mockTermRepoServicer.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoRolloverManager,
      "AlreadyTermContractPaired",
    );
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
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
        .withArgs(termRepoRolloverManager.address, wallet1.address);

      await expect(
        termRepoRolloverManager.connect(wallet2).upgrade(wallet2.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
  });

  describe("Invalid Signature Reverts", async () => {
    it("elections and cancellations fail if signatures revert", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);

      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );

      await expect(
        termRepoRolloverManager.connect(wallet3).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.reverted;

      await expect(termRepoRolloverManager.connect(wallet3).cancelRollover()).to
        .be.reverted;
    });
  });

  describe("Rollover Term Approval tests", async () => {
    it("Rollover Term approval reverts if maturity reached", async () => {
      await network.provider.send("evm_increaseTime", [60 * 60 * 25 * 365]);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "MaturityReached",
      );
    });
    it("Rollover Term approved only if called by admin role", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);
      mockAuctionBidLocker.termRepoId.returns(ethers.constants.HashZero);
      mockAuctionBidLocker.termAuctionId.returns(ethers.constants.HashZero);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);

      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(wallet2)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`,
      );

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.emit(termEventEmitter, "RolloverTermApproved")
        .withArgs(termIdHashed, ethers.constants.HashZero);
    });

    it("Rollover Term not approved, invalid auction contracts", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(false);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(false);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockAuctionBidLocker.purchaseToken.returns(collateralToken1.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(false);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `NotTermContract`,
        )
        .withArgs(mockAuctionBidLocker.address);
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `NotTermContract`,
        )
        .withArgs(auction.address);

      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `DifferentPurchaseToken`,
        )
        .withArgs(purchaseTokenAddress.address, collateralToken1.address);

      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.be.revertedWithCustomError(
          termRepoRolloverManager,
          `CollateralTokenNotSupported`,
        )
        .withArgs(collateralToken2.address);
    });

    it("Rollover Term not approved, auction ends after repayment", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 6,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AuctionEndsAfterRepayment",
      );
    });

    it("Rollover Term not approved, auction ends before maturity", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address, auction.address)
        .returns(true);
      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear - 60 * 60 * 2,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "AuctionEndsBeforeMaturity",
      );
    });
    it("Rollover Term  approved and then revoked", async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);

      mockAuctionBidLocker.termRepoId.returns(ethers.constants.HashZero);
      mockAuctionBidLocker.termAuctionId.returns(ethers.constants.HashZero);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .approveRolloverAuction(
            mockAuctionBidLocker.address,
            auction.address,
          ),
      )
        .to.emit(termEventEmitter, "RolloverTermApproved")
        .withArgs(termIdHashed, constants.HashZero);

      await expect(
        termRepoRolloverManager
          .connect(adminWallet)
          .revokeRolloverApproval(mockAuctionBidLocker.address),
      )
        .to.emit(termEventEmitter, "RolloverTermApprovalRevoked")
        .withArgs(termIdHashed, constants.HashZero);
    });
  });
  describe("Rollover Term Borrows", async () => {
    beforeEach(async () => {
      mockTermController.isTermDeployed
        .whenCalledWith(mockAuctionBidLocker.address)
        .returns(true);
      mockTermController.isTermDeployed
        .whenCalledWith(auction.address)
        .returns(true);

      mockAuctionBidLocker.termRepoId.returns(ethers.constants.HashZero);
      mockAuctionBidLocker.termAuctionId.returns(ethers.constants.HashZero);

      mockAuctionBidLocker.auctionEndTime.returns(
        maturationTimestampOneYear + 60 * 60 * 5,
      );
      mockAuctionBidLocker.purchaseToken.returns(purchaseTokenAddress.address);
      mockTermRepoServicer.maturityTimestamp.returns(
        maturationTimestampOneYear,
      );
      mockTermRepoServicer.endOfRepurchaseWindow.returns(
        maturationTimestampOneYear + 60 * 60 * 15,
      );
      mockTermRepoServicer.purchaseToken.returns(purchaseTokenAddress.address);

      mockTermRepoServicer.approveRolloverAuction.returns();
      mockTermRepoCollateralManager.approveRolloverAuction.returns();

      mockTermRepoCollateralManager.numOfAcceptedCollateralTokens.returns(2);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(0)
        .returns(collateralToken1.address);
      mockTermRepoCollateralManager.collateralTokens
        .whenCalledWith(1)
        .returns(collateralToken2.address);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken1.address)
        .returns(true);
      mockAuctionBidLocker.collateralTokens
        .whenCalledWith(collateralToken2.address)
        .returns(true);

      mockAuctionBidLocker.termRepoServicer.returns(
        mockFutureTermRepoServicer.address,
      );
      mockFutureTermRepoServicer.servicingFee.returns("20000000000000000");

      mockTermRepoServicer.getBorrowerRepurchaseObligation
        .whenCalledWith(wallet1.address)
        .returns("90000000000");
      mockTermRepoServicer.getBorrowerRepurchaseObligation
        .whenCalledWith(wallet2.address)
        .returns("90000000000");
      mockTermRepoServicer.getBorrowerRepurchaseObligation
        .whenCalledWith(wallet3.address)
        .returns("90000000000");

      await termRepoRolloverManager
        .connect(adminWallet)
        .approveRolloverAuction(mockAuctionBidLocker.address, auction.address);
    });
    it("Rollover Term Election reverted if address is not approved", async () => {
      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: wallet1.address,
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
    it("Rollover Term Election reverted if borrow balance is zero", async () => {
      mockTermRepoServicer.getBorrowerRepurchaseObligation
        .whenCalledWith(wallet1.address)
        .returns(0);
      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: wallet1.address,
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
    it("Rollover Term Election reverted if rolloverAmount is zero", async () => {
      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
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
      mockTermRepoCollateralManager.getCollateralBalances
        .whenCalledWith(wallet1.address)
        .returns([[collateralToken1.address], ["10000000000"]]);
      mockTermRepoCollateralManager.getCollateralBalances
        .whenCalledWith(wallet2.address)
        .returns([[collateralToken2.address], ["10000000000"]]);
      mockAuctionBidLocker.lockRolloverBid.returns(true);
      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      await expect(
        termRepoRolloverManager.connect(wallet1).cancelRollover(),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        `NoRolloverToCancel`,
      );

      mockAuctionBidLocker.lockRolloverBid.returns(true);

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "10000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ethers.constants.HashZero,
          wallet1.address,
          mockAuctionBidLocker.address,
          "10000000000",
          rolloverBidPriceHash,
        );

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "20000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ethers.constants.HashZero,
          wallet1.address,
          mockAuctionBidLocker.address,
          "20000000000",
          rolloverBidPriceHash,
        );
      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        mockAuctionBidLocker.address,
        BigNumber.from("20000000000"),
        rolloverBidPriceHash,
        false,
      ]);
      await expect(
        termRepoRolloverManager.connect(wallet2).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "30000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ethers.constants.HashZero,
          wallet2.address,
          mockAuctionBidLocker.address,
          "30000000000",
          rolloverBidPriceHash,
        );
      await expect(termRepoRolloverManager.connect(wallet2).cancelRollover())
        .to.emit(termEventEmitter, "RolloverCancellation")
        .withArgs(termIdHashed, wallet2.address);
      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet2.address),
      ).to.deep.equal([
        ethers.constants.AddressZero,
        BigNumber.from("0"),
        ethers.constants.HashZero,
        false,
      ]);
      await expect(
        termRepoRolloverManager.connect(wallet2).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      )
        .to.emit(termEventEmitter, "RolloverElection")
        .withArgs(
          termIdHashed,
          ethers.constants.HashZero,
          wallet2.address,
          mockAuctionBidLocker.address,
          "40000000000",
          rolloverBidPriceHash,
        );

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        mockAuctionBidLocker.address,
        BigNumber.from("20000000000"),
        rolloverBidPriceHash,
        false,
      ]);

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet2.address),
      ).to.deep.equal([
        mockAuctionBidLocker.address,
        BigNumber.from("40000000000"),
        rolloverBidPriceHash,
        false,
      ]);

      await termRepoRolloverManager
        .connect(termInitializer)
        .testRepairTermContracts(
          servicerSigner.address,
          termEventEmitter.address,
        );

      await expect(
        termRepoRolloverManager.fulfillRollover(wallet1.address),
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x960771d60d61bb60ec2f92e1fcc4b84a2e0e340697e8b2b1256a2a12f5f59c69`,
      );

      await termRepoRolloverManager
        .connect(servicerSigner)
        .fulfillRollover(wallet1.address);

      expect(
        await termRepoRolloverManager.getRolloverInstructions(wallet1.address),
      ).to.deep.equal([
        mockAuctionBidLocker.address,
        BigNumber.from("20000000000"),
        rolloverBidPriceHash,
        true,
      ]);

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
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

      await network.provider.send("evm_increaseTime", [60 * 60 * 24 * 366]);

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
          rolloverAmount: "40000000000",
          rolloverBidPriceHash,
        }),
      ).to.be.revertedWithCustomError(
        termRepoRolloverManager,
        "MaturityReached",
      );
    });
    it("Election and then Rollover Fails due to borrow balance too low", async () => {
      const rolloverBidPriceHash = ethers.utils.solidityKeccak256(
        ["uint256"],
        ["100000000000"],
      );
      mockTermRepoServicer.getBorrowerRepurchaseObligation
        .whenCalledWith(wallet1.address)
        .returns("11000000000");

      await expect(
        termRepoRolloverManager.connect(wallet1).electRollover({
          rolloverAuction: mockAuctionBidLocker.address,
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
