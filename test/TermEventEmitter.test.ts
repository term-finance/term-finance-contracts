/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { TestTermEventEmitter } from "../typechain-types";

describe("TermEventEmitter", () => {
  let wallets: SignerWithAddress[];
  let termEventEmitter: TestTermEventEmitter;
  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    wallets = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TestTermEventEmitter",
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [wallets[3].address, wallets[4].address, wallets[5].address],
      { kind: "uups" },
    )) as TestTermEventEmitter;
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
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`,
    );
  });

  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await termEventEmitter.connect(wallets[3]).upgrade(wallets[0].address);

    await expect(
      termEventEmitter.connect(wallets[1]).upgrade(wallets[0].address),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );
  });
  it("auction event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionInitialized(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          wallets[1].address,
          0,
          "0.1.0",
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidAssigned(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferAssigned(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitAuctionCompleted(ethers.constants.HashZero, 0, 0, 0, 0, 0),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitAuctionCancelled(ethers.constants.HashZero, true, false),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("auction bidlocker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionBidLockerInitialized(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          wallets[1].address,
          0,
          0,
          ethers.constants.MaxUint256,
          ethers.constants.Two,
          ethers.constants.One,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter.connect(wallets[1]).emitBidLocked(
        ethers.constants.HashZero,
        {
          id: ethers.constants.HashZero,
          bidPriceHash: ethers.constants.HashZero,
          bidPriceRevealed: "10",
          bidder: ethers.constants.AddressZero,
          amount: 9000,
          collateralTokens: [],
          collateralAmounts: [],
          isRevealed: true,
          isRollover: false,
          rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
          purchaseToken: ethers.constants.AddressZero,
        },
        ethers.constants.AddressZero,
      ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidRevealed(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidUnlocked(ethers.constants.HashZero, ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidInShortfall(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidLockingPaused(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidLockingUnpaused(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("auction termAuctionOfferLocker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermAuctionOfferLockerInitialized(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          wallets[1].address,
          0,
          0,
          ethers.constants.MaxUint256,
          ethers.constants.Two,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLocked(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.HashZero,
          0,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferRevealed(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferUnlocked(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockingPaused(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockingUnpaused(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("collateral manager event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoCollateralManagerInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          [],
          [],
          [],
          [],
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitPairReopeningBidLocker(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitCollateralLocked(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitCollateralUnlocked(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitLiquidation(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
          ethers.constants.AddressZero,
          0,
          0,
          false,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitLiquidationPaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitLiquidationUnpaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("servicer event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoServicerInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
          0,
          0,
          0,
          "0.1.0",
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitReopeningOfferLockerPaired(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferLockedByServicer(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferUnlockedByServicer(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitOfferFulfilled(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
          0,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokensRedeemed(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBidFulfilled(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
          0,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitExposureOpenedOnRolloverNew(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
          0,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitExposureClosedOnRolloverExisting(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRepurchasePaymentSubmitted(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitMintExposure(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
          0,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitBurnCollapseExposure(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("rollover manager event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoRolloverManagerInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverTermApproved(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverElection(
          ethers.constants.HashZero,
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          0,
          ethers.constants.HashZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverCancellation(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverProcessed(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("term repo locker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersPaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersUnpaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverCancellation(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitRolloverProcessed(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("term repo locker event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersPaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoLockerTransfersUnpaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("term repo token event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenInitialized(
          ethers.constants.HashZero,
          ethers.constants.AddressZero,
          0,
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenMintingPaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenMintingUnpaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenBurningPaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitTermRepoTokenBurningUnpaused(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0xd826f92d418c5d20475612da193d2053b8323c543561622a20bce855d857e321`,
    );
  });
  it("term event emitter events can be emitted", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[4])
        .emitDelistTermRepo(ethers.constants.HashZero),
    ).to.emit(termEventEmitter, "DelistTermRepo");

    await expect(
      termEventEmitter
        .connect(wallets[4])
        .emitDelistTermAuction(ethers.constants.HashZero),
    ).to.emit(termEventEmitter, "DelistTermAuction");
  });
  it("term event emitter event emissions are access controlled", async () => {
    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitDelistTermRepo(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x992b7de0144989096133dd485c7c23b149cc4ea0152d8a6481d467e12f7fc71f`,
    );

    await expect(
      termEventEmitter
        .connect(wallets[1])
        .emitDelistTermAuction(ethers.constants.HashZero),
    ).to.be.revertedWith(
      `AccessControl: account ${wallets[1].address.toLowerCase()} is missing role 0x992b7de0144989096133dd485c7c23b149cc4ea0152d8a6481d467e12f7fc71f`,
    );
  });
  it("version returns the current contract version", async () => {
    expect(await termEventEmitter.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
