/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { TestTermEventEmitter } from "../typechain-types";
import { MaxUint256, ZeroAddress, ZeroHash } from "ethers";

describe("TermEventEmitter", () => {
  let wallets: SignerWithAddress[];
  let termEventEmitter: TestTermEventEmitter;
  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    wallets = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deploymentTransaction()?.wait();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TestTermEventEmitter",
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[3].address, wallets[4].address, wallets[5].address, wallets[4].address, wallets[5].address],
      { kind: "uups" },
    )) as unknown as TestTermEventEmitter;
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("pair term contract reverted if called by somebody else other than admin", async () => {
    await expect(
      termEventEmitter.connect(wallets[1]).pairTermContract(wallets[0].address),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });

  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await termEventEmitter.connect(wallets[3]).upgrade(wallets[0].address);

    await expect(
      termEventEmitter.connect(wallets[1]).upgrade(wallets[0].address),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("auction event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionInitialized(
          ZeroHash,
          ZeroHash,
          wallets[1].address,
          0,
          wallets[1].address,
          "0.1.0",
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidAssigned(ZeroHash, ZeroHash, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferAssigned(ZeroHash, ZeroHash, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitAuctionCompleted(ZeroHash, 0, 0, 0, 0, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitAuctionCancelled(ZeroHash, true, false),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("auction bidlocker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionBidLockerInitialized(
          ZeroHash,
          ZeroHash,
          wallets[1].address,
          0,
          0,
          MaxUint256,
          2n,
          1n,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitBidLocked(
        ZeroHash,
        {
          id: ZeroHash,
          bidPriceHash: ZeroHash,
          bidPriceRevealed: "10",
          bidder: ZeroAddress,
          amount: 9000,
          collateralTokens: [],
          collateralAmounts: [],
          isRevealed: true,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ZeroAddress,
          purchaseToken: ZeroAddress,
        },
        ZeroAddress,
      ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidRevealed(ZeroHash, ZeroHash, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitBidUnlocked(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidInShortfall(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidLockingPaused(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidLockingUnpaused(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("auction termAuctionOfferLocker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionOfferLockerInitialized(
          ZeroHash,
          ZeroHash,
          wallets[1].address,
          0,
          0,
          MaxUint256,
          2n,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLocked(
          ZeroHash,
          ZeroHash,
          ZeroAddress,
          ZeroHash,
          0,
          ZeroAddress,
          ZeroAddress,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferRevealed(ZeroHash, ZeroHash, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferUnlocked(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockingPaused(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockingUnpaused(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("collateral manager event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoCollateralManagerInitialized(
          ZeroHash,
          ZeroAddress,
          [],
          [],
          [],
          [],
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitPairReopeningBidLocker(ZeroHash, ZeroAddress, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitCollateralLocked(ZeroHash, ZeroAddress, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitCollateralUnlocked(ZeroHash, ZeroAddress, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitLiquidation(
          ZeroHash,
          ZeroAddress,
          ZeroAddress,
          0,
          ZeroAddress,
          0,
          0,
          false,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitLiquidationPaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitLiquidationUnpaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("servicer event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoServicerInitialized(
          ZeroHash,
          ZeroAddress,
          ZeroAddress,
          0,
          0,
          0,
          0,
          wallets[1].address,
          "0.1.0",
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitReopeningOfferLockerPaired(
          ZeroHash,
          ZeroAddress,
          ZeroAddress,
          ZeroAddress,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockedByServicer(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferUnlockedByServicer(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferFulfilled(ZeroHash, ZeroAddress, 0, 0, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokensRedeemed(ZeroHash, ZeroAddress, 0, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidFulfilled(ZeroHash, ZeroAddress, 0, 0, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitExposureOpenedOnRolloverNew(ZeroHash, ZeroAddress, 0, 0, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitExposureClosedOnRolloverExisting(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRepurchasePaymentSubmitted(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitMintExposure(ZeroHash, ZeroAddress, 0, 0, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBurnCollapseExposure(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("rollover manager event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoRolloverManagerInitialized(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverTermApproved(ZeroHash, ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverElection(
          ZeroHash,
          ZeroHash,
          ZeroAddress,
          ZeroAddress,
          0,
          ZeroHash,
        ),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverCancellation(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverProcessed(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("term repo locker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerInitialized(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersPaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersUnpaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverCancellation(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverProcessed(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("term repo locker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerInitialized(ZeroHash, ZeroAddress),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersPaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersUnpaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("term repo token event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenInitialized(ZeroHash, ZeroAddress, 0),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenMintingPaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenMintingUnpaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenBurningPaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenBurningUnpaused(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("term event emitter events can be emitted", async () => {
    await expect(
      termEventEmitter.connect(wallets[4]).emitDelistTermRepo(ZeroHash),
    ).to.emit(termEventEmitter, "DelistTermRepo");

    await expect(
      termEventEmitter.connect(wallets[4]).emitDelistTermAuction(ZeroHash),
    ).to.emit(termEventEmitter, "DelistTermAuction");
  });
  it("term event emitter event emissions are access controlled", async () => {
    await expect(
      termEventEmitter.connect(wallets[1]).emitDelistTermRepo(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitDelistTermAuction(ZeroHash),
    ).to.be.revertedWithCustomError(
      termEventEmitter,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("version returns the current contract version", async () => {
    expect(await termEventEmitter.version()).to.eq(expectedVersion);
  });

  describe("emit function success paths", () => {
    // wallets[4] has ADMIN_ROLE, wallets[5] has INITIALIZER_ROLE
    // Grant wallets[6] TERM_CONTRACT role before each test
    beforeEach(async () => {
      await termEventEmitter
        .connect(wallets[5])
        .pairTermContract(wallets[6].address);
    });

    it("pairTermFactory grants INITIALIZER_ROLE", async () => {
      await expect(
        termEventEmitter
          .connect(wallets[4])
          .pairTermFactory(wallets[7].address),
      ).to.not.be.reverted;
      // wallets[7] now has INITIALIZER_ROLE and can pair a contract
      await expect(
        termEventEmitter
          .connect(wallets[7])
          .pairTermContract(wallets[8].address),
      ).to.not.be.reverted;
    });

    it("pairTermContract success", async () => {
      await expect(
        termEventEmitter
          .connect(wallets[5])
          .pairTermContract(wallets[7].address),
      ).to.not.be.reverted;
    });

    it("auction events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermAuctionInitialized(
          ZeroHash, ZeroHash, wallets[0].address, 0, wallets[0].address, "0.1.0",
        ),
      ).to.emit(termEventEmitter, "TermAuctionInitialized");

      await expect(tc.emitBidAssigned(ZeroHash, ZeroHash, 0))
        .to.emit(termEventEmitter, "BidAssigned");

      await expect(tc.emitOfferAssigned(ZeroHash, ZeroHash, 0))
        .to.emit(termEventEmitter, "OfferAssigned");

      await expect(tc.emitAuctionCompleted(ZeroHash, 0, 0, 0, 0, 0))
        .to.emit(termEventEmitter, "AuctionCompleted");

      await expect(tc.emitAuctionCancelled(ZeroHash, true, false))
        .to.emit(termEventEmitter, "AuctionCancelled");

      await expect(tc.emitCompleteAuctionPaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "CompleteAuctionPaused");

      await expect(tc.emitCompleteAuctionUnpaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "CompleteAuctionUnpaused");
    });

    it("bid locker events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermAuctionBidLockerInitialized(
          ZeroHash, ZeroHash, wallets[0].address, 0, 0, MaxUint256, 2n, 1n,
        ),
      ).to.emit(termEventEmitter, "TermAuctionBidLockerInitialized");

      await expect(
        tc.emitBidLocked(
          ZeroHash,
          {
            id: ZeroHash,
            bidPriceHash: ZeroHash,
            bidPriceRevealed: 0,
            bidder: ZeroAddress,
            amount: 0,
            collateralTokens: [],
            collateralAmounts: [],
            isRevealed: false,
            isRollover: false,
            rolloverPairOffTermRepoServicer: ZeroAddress,
            purchaseToken: ZeroAddress,
          },
          ZeroAddress,
        ),
      ).to.emit(termEventEmitter, "BidLocked");

      await expect(tc.emitBidRevealed(ZeroHash, ZeroHash, 0))
        .to.emit(termEventEmitter, "BidRevealed");

      await expect(tc.emitBidUnlocked(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidUnlocked");

      await expect(tc.emitBidInShortfall(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidInShortfall");

      await expect(tc.emitBidLockingPaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidLockingPaused");

      await expect(tc.emitBidLockingUnpaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidLockingUnpaused");

      await expect(tc.emitBidUnlockingPaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidUnlockingPaused");

      await expect(tc.emitBidUnlockingUnpaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "BidUnlockingUnpaused");
    });

    it("offer locker events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermAuctionOfferLockerInitialized(
          ZeroHash, ZeroHash, wallets[0].address, 0, 0, MaxUint256, 2n,
        ),
      ).to.emit(termEventEmitter, "TermAuctionOfferLockerInitialized");

      await expect(
        tc.emitOfferLocked(ZeroHash, ZeroHash, ZeroAddress, ZeroHash, 0, ZeroAddress, ZeroAddress),
      ).to.emit(termEventEmitter, "OfferLocked");

      await expect(tc.emitOfferRevealed(ZeroHash, ZeroHash, 0))
        .to.emit(termEventEmitter, "OfferRevealed");

      await expect(tc.emitOfferUnlocked(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "OfferUnlocked");

      await expect(tc.emitOfferLockingPaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "OfferLockingPaused");

      await expect(tc.emitOfferLockingUnpaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "OfferLockingUnpaused");

      await expect(tc.emitOfferUnlockingPaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "OfferUnlockingPaused");

      await expect(tc.emitOfferUnlockingUnpaused(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "OfferUnlockingUnpaused");
    });

    it("collateral manager events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermRepoCollateralManagerInitialized(
          ZeroHash, ZeroAddress, [], [], [], [],
        ),
      ).to.emit(termEventEmitter, "TermRepoCollateralManagerInitialized");

      await expect(
        tc.emitPairReopeningBidLocker(ZeroHash, ZeroAddress, ZeroAddress),
      ).to.emit(termEventEmitter, "PairReopeningBidLocker");

      await expect(
        tc.emitCollateralLocked(ZeroHash, ZeroAddress, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "CollateralLocked");

      await expect(
        tc.emitCollateralUnlocked(ZeroHash, ZeroAddress, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "CollateralUnlocked");

      await expect(
        tc.emitLiquidation(ZeroHash, ZeroAddress, ZeroAddress, 0, ZeroAddress, 0, 0, false),
      ).to.emit(termEventEmitter, "Liquidation");

      await expect(tc.emitLiquidationPaused(ZeroHash))
        .to.emit(termEventEmitter, "LiquidationsPaused");

      await expect(tc.emitLiquidationUnpaused(ZeroHash))
        .to.emit(termEventEmitter, "LiquidationsUnpaused");
    });

    it("servicer events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermRepoServicerInitialized(
          ZeroHash, ZeroAddress, ZeroAddress, 0, 0, 0, 0, ZeroAddress, "0.1.0",
        ),
      ).to.emit(termEventEmitter, "TermRepoServicerInitialized");

      await expect(
        tc.emitReopeningOfferLockerPaired(ZeroHash, ZeroAddress, ZeroAddress, ZeroAddress),
      ).to.emit(termEventEmitter, "ReopeningOfferLockerPaired");

      await expect(
        tc.emitOfferLockedByServicer(ZeroHash, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "OfferLockedByServicer");

      await expect(
        tc.emitOfferUnlockedByServicer(ZeroHash, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "OfferUnlockedByServicer");

      await expect(tc.emitOfferFulfilled(ZeroHash, ZeroAddress, 0, 0, 0))
        .to.emit(termEventEmitter, "OfferFulfilled");

      await expect(tc.emitTermRepoTokensRedeemed(ZeroHash, ZeroAddress, 0, 0))
        .to.emit(termEventEmitter, "TermRepoTokensRedeemed");

      await expect(tc.emitBidFulfilled(ZeroHash, ZeroAddress, 0, 0, 0))
        .to.emit(termEventEmitter, "BidFulfilled");

      await expect(
        tc.emitExposureOpenedOnRolloverNew(ZeroHash, ZeroAddress, 0, 0, 0),
      ).to.emit(termEventEmitter, "ExposureOpenedOnRolloverNew");

      await expect(
        tc.emitExposureClosedOnRolloverExisting(ZeroHash, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "ExposureClosedOnRolloverExisting");

      await expect(
        tc.emitRepurchasePaymentSubmitted(ZeroHash, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "RepurchasePaymentSubmitted");

      await expect(
        tc.emitMintExposureAccessGranted(ZeroHash, ZeroAddress),
      ).to.emit(termEventEmitter, "MintExposureAccessGranted");

      await expect(tc.emitMintExposure(ZeroHash, ZeroAddress, 0, 0, 0))
        .to.emit(termEventEmitter, "TermRepoTokenMint");

      await expect(tc.emitBurnCollapseExposure(ZeroHash, ZeroAddress, 0))
        .to.emit(termEventEmitter, "BurnCollapseExposure");
    });

    it("rollover manager events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitTermRepoRolloverManagerInitialized(ZeroHash, ZeroAddress),
      ).to.emit(termEventEmitter, "TermRepoRolloverManagerInitialized");

      await expect(tc.emitRolloverTermApproved(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "RolloverTermApproved");

      await expect(tc.emitRolloverTermApprovalRevoked(ZeroHash, ZeroHash))
        .to.emit(termEventEmitter, "RolloverTermApprovalRevoked");

      await expect(
        tc.emitRolloverElection(ZeroHash, ZeroHash, ZeroAddress, ZeroAddress, 0, ZeroHash),
      ).to.emit(termEventEmitter, "RolloverElection");

      await expect(tc.emitRolloverCancellation(ZeroHash, ZeroAddress))
        .to.emit(termEventEmitter, "RolloverCancellation");

      await expect(tc.emitRolloverProcessed(ZeroHash, ZeroAddress))
        .to.emit(termEventEmitter, "RolloverProcessed");
    });

    it("locker and token events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(tc.emitTermRepoLockerInitialized(ZeroHash, ZeroAddress))
        .to.emit(termEventEmitter, "TermRepoLockerInitialized");

      await expect(tc.emitTermRepoLockerTransfersPaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoLockerTransfersPaused");

      await expect(tc.emitTermRepoLockerTransfersUnpaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoLockerTransfersUnpaused");

      await expect(tc.emitTermRepoTokenInitialized(ZeroHash, ZeroAddress, 0))
        .to.emit(termEventEmitter, "TermRepoTokenInitialized");

      await expect(tc.emitTermRepoTokenMintingPaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoTokenMintingPaused");

      await expect(tc.emitTermRepoTokenMintingUnpaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoTokenMintingUnpaused");

      await expect(tc.emitTermRepoTokenBurningPaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoTokenBurningPaused");

      await expect(tc.emitTermRepoTokenBurningUnpaused(ZeroHash))
        .to.emit(termEventEmitter, "TermRepoTokenBurningUnpaused");

      await expect(tc.emitTermContractUpgraded(ZeroAddress, ZeroAddress))
        .to.emit(termEventEmitter, "TermContractUpgraded");
    });

    it("intent and swap events emit successfully", async () => {
      const tc = termEventEmitter.connect(wallets[6]);

      await expect(
        tc.emitIntentFilled(
          ZeroHash, ZeroHash, ZeroAddress, ZeroAddress, ZeroAddress,
          ZeroAddress, ZeroAddress, 0, 0, 0, 0, ZeroAddress, 0, 0, 0,
        ),
      ).to.emit(termEventEmitter, "IntentFilled");

      await expect(tc.emitIntentCancelled(ZeroHash))
        .to.emit(termEventEmitter, "IntentCancelled");

      await expect(
        tc.emitRepoTokenSwapFilled(ZeroHash, {
          repoToken: ZeroAddress,
          purchaseToken: ZeroAddress,
          maker: ZeroAddress,
          taker: ZeroAddress,
          makerToken: ZeroAddress,
          takerToken: ZeroAddress,
          discountRate: 0,
          makerTokenAmountFilled: 0,
          takerTokenAmountFilled: 0,
          makerFee: 0,
          takerFee: 0,
          feeRecipient: ZeroAddress,
          originalOrderAmount: 0,
          expiry: 0,
          salt: 0,
        }),
      ).to.emit(termEventEmitter, "RepoTokenSwapFilled");

      await expect(
        tc.emitLimitOrderTokenPairMinSaltValue(ZeroAddress, ZeroAddress, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "LimitOrderTokenPairMinSalt");

      await expect(
        tc.emitSwapOrderTokenPairMinSaltValue(ZeroAddress, ZeroAddress, ZeroAddress, 0),
      ).to.emit(termEventEmitter, "SwapOrderTokenPairMinSalt");
    });
  });
});
/* eslint-enable camelcase */
