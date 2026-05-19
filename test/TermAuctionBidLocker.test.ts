/* eslint-disable no-unused-expressions */
/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  ERC20Upgradeable,
  TermRepoCollateralManager,
  TermEventEmitter,
  TermPriceConsumerV3,
  TermRepoServicer,
  TestingTermAuctionBidLocker,
  ITermRepoCollateralManager,
  TermRepoServicer__factory,
  TermRepoCollateralManager__factory,
  ERC20Upgradeable__factory,
  TermPriceConsumerV3__factory,
  TermController,
  TermController__factory,
} from "../typechain-types";
import dayjs from "dayjs";
import { getBytesHash, getGeneratedTenderId } from "../utils/simulation-utils";
import {
  MockContract,
  deployMockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";
import {
  MaxUint256,
  ZeroAddress,
  ZeroHash,
  solidityPackedKeccak256,
} from "ethers";

describe("TermAuctionBidLocker (Not in shortfall)", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let termDiamond: SignerWithAddress;

  let termAuction: SignerWithAddress;
  let previousTermRepoRolloverManager: SignerWithAddress;
  let testCollateralToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let testBorrowedToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let testUnapprovedToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let termOracle: MockContract<TermPriceConsumerV3> & TermPriceConsumerV3;
  let termEventEmitter: TermEventEmitter;
  let termAuctionBidLocker: TestingTermAuctionBidLocker &
    TestingTermAuctionBidLocker;
  let termRepoCollateralManager: MockContract<TermRepoCollateralManager> &
    ITermRepoCollateralManager;
  let pairOffTermRepoCollateralManager: MockContract<ITermRepoCollateralManager> &
    ITermRepoCollateralManager;
  let termRepoServicer: MockContract<TermRepoServicer> & TermRepoServicer;
  let termController: MockContract<TermController> & TermController;
  let pairOffTermRepoServicer: MockContract<TermRepoServicer> &
    TermRepoServicer;

  let termIdString: string;

  let auctionIdString: string;
  let auctionIdHash: string;

  let snapshotId: any;
  let expectedVersion: string;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");

    upgrades.silenceWarnings();

    [
      wallet1,
      wallet2,
      wallet3,
      termInitializer,
      devopsMultisig,
      adminWallet,
      termAuction,
      previousTermRepoRolloverManager,
      termDiamond,
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

    testCollateralToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    testBorrowedToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    testUnapprovedToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );

    pairOffTermRepoCollateralManager =
      await deployMockContract<TermRepoCollateralManager>(
        wallet1,
        TermRepoCollateralManager__factory.abi,
      );

    termRepoCollateralManager =
      await deployMockContract<TermRepoCollateralManager>(
        wallet1,
        TermRepoCollateralManager__factory.abi,
      );
    await termRepoCollateralManager.mock.initialCollateralRatios.returns(
      15n * 10n ** 16n,
    );
    await termRepoCollateralManager.mock.maintenanceCollateralRatios.returns(
      110n * 10n ** 16n,
    );

    termRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );

    termController = await deployMockContract<TermController>(
      wallet1,
      TermController__factory.abi,
    );

    pairOffTermRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );
    await termRepoServicer.mock.servicingFee.returns("1" + "0".repeat(17));
    await termRepoServicer.mock.termController.returns(await termController.getAddress());
    await termController.mock.termContractsPaused.returns(false);

    await pairOffTermRepoServicer.mock.termRepoCollateralManager.returns(
      await pairOffTermRepoCollateralManager.getAddress(),
    );

    termOracle = await deployMockContract<TermPriceConsumerV3>(
      wallet1,
      TermPriceConsumerV3__factory.abi,
    );

    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker",
    );

    const currentTimestamp = dayjs();

    termIdString = "termIdString";

    auctionIdString = "auctionIdString";

    termAuctionBidLocker = (await upgrades.deployProxy(
      termAuctionBidLockerFactory,
      [
        termIdString,
        auctionIdString,
        BigInt(currentTimestamp.subtract(10, "hours").unix()),
        BigInt(currentTimestamp.add(10, "hours").unix()),
        BigInt(currentTimestamp.add(20, "hours").unix()),
        BigInt(currentTimestamp.add(10, "day").unix()),
        100n,
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termAuctionBidLocker.getAddress());

    auctionIdHash = solidityPackedKeccak256(["string"], [auctionIdString]);

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairTermContracts(
          termAuction.address,
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await termOracle.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address
        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AccessControlUnauthorizedAccount",
    );
  

    await termAuctionBidLocker
      .connect(termInitializer)
      .pairTermContracts(
        termAuction.address,
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        await termRepoCollateralManager.getAddress(),
        await termOracle.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
        termDiamond.address
      );

    await expect(
      termAuctionBidLocker
        .connect(termInitializer)
        .pairTermContracts(
          termAuction.address,
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await termOracle.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address
        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AlreadyTermContractPaired",
    );
    
    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairRolloverManager(previousTermRepoRolloverManager.address),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AccessControlUnauthorizedAccount",
    );
      
    await termAuctionBidLocker
      .connect(adminWallet)
      .pairRolloverManager(previousTermRepoRolloverManager.address);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("lockBids takes collateral and saves a user's bids", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });
    // await termOracle.mock.usdValueOfTokens.withArgs(await testBorrowedToken.getAddress(), 2000n).returns({mantissa: 10n ** 9n})
    // await termOracle.mock.usdValueOfTokens.withArgs(await testCollateralToken.getAddress(), 10000000n).returns({mantissa: 10n ** 24n})

    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5772871823",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5772871823",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "812588125",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionBidLocker,
      wallet1,
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-7"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "4444444"],
          ),
          amount: "2000",
          collateralAmounts: [10000000n],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "4444444"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        [10000000n],
        false,
        ZeroAddress,
        ZeroAddress,
      );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids([testId7Id], ["15"], ["4444444"]),
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(await termAuctionBidLocker.lockedBid(testId7Id)).to.deep.equal([
      testId7Id,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0xe5326933fc206a73be2bb2beeebe6bfbe9574bd07543f0764d9cd0df1abf80a0",
      15n,
      2000n,
      [10000000n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      false,
      ZeroAddress,
      true,
    ]);
  });

  it("lockBidsWithReferral takes collateral and saves a user's bid and emits a referral event", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 9n });
    // await termRepoCollateralManager.mock.initialCollateralRatios.returns(1n);
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5772871823",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5772871823",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "8127525",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionBidLocker,
      wallet1,
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBidsWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            bidder: wallet1.address,
            bidPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["15", "88888888"],
            ),
            amount: 2000n,
            collateralAmounts: ["1000"],
            purchaseToken: await testBorrowedToken.getAddress(),
            collateralTokens: [await testCollateralToken.getAddress()],
          },
        ],
        wallet2.address,
      ),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "88888888"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["1000"],
        false,
        ZeroAddress,
        wallet2.address,
      );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids([testId7Id], ["15"], ["88888888"]),
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(await termAuctionBidLocker.lockedBid(testId7Id)).to.deep.equal([
      testId7Id,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0xa3214f1377ab073aaef1dab159d29eb40e5b8a6cd3d376375f6625687ffda283",
      15n,
      2000n,
      [1000n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      false,
      ZeroAddress,
      true,
    ]);
  });
  it("can pause and unpause (lock)", async () => {
    // await termRepoCollateralManager.mock.initialCollateralRatios.returns("10");
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: "10" });
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();

    const block = await ethers.provider.getBlock("latest");
    const currentBlockTime = block!.timestamp;
    await termAuctionBidLocker.setStartTime(currentBlockTime - 600);
    await termAuctionBidLocker.setRevealTime(currentBlockTime + 600);

    await expect(
      termAuctionBidLocker.connect(adminWallet).pauseLocking(),
    ).to.emit(termEventEmitter, "BidLockingPaused");
    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "LockingPaused");
    await expect(
      termAuctionBidLocker.connect(adminWallet).unpauseLocking(),
    ).to.emit(termEventEmitter, "BidLockingUnpaused");
    const testId1Id = await getGeneratedTenderId(
      getBytesHash("test-id-1"),
      termAuctionBidLocker,
      wallet1,
    );
    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId1Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256"], ["15000000"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["1"],
        false,
        ZeroAddress,
        ZeroAddress,
      );
  });
  it("can pause and unpause (unlock)", async () => {
    // await termRepoCollateralManager.mock.initialCollateralRatios.returns("10");
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: "10" });
    await termRepoCollateralManager.mock.auctionUnlockCollateral.returns();

    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["1"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "68247214",
    );

    const block = await ethers.provider.getBlock("latest");
    const currentBlockTime = block!.timestamp;
    await termAuctionBidLocker.setStartTime(currentBlockTime - 600);
    await termAuctionBidLocker.setRevealTime(currentBlockTime + 600);

    await expect(
      termAuctionBidLocker.connect(adminWallet).pauseUnlocking(),
    ).to.emit(termEventEmitter, "BidUnlockingPaused");
    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker, "UnlockingPaused");
    await expect(
      termAuctionBidLocker.connect(adminWallet).unpauseUnlocking(),
    ).to.emit(termEventEmitter, "BidUnlockingUnpaused");
    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")]),
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"));
  });
  it("editing a bid with less collateral unlocks user collateral", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    await termRepoCollateralManager.mock.auctionUnlockCollateral.returns();
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });

    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "7264161",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["10000000000000000", "7264161"],
          ),
          amount: "300",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["200"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet1.address,
        solidityPackedKeccak256(
          ["uint256", "uint256"],
          ["10000000000000000", "7264161"],
        ),
        "300",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["200"],
        false,
        ZeroAddress,
        ZeroAddress,
      );
    // expect(
    //   termRepoCollateralManager.auctionUnlockCollateral,
    // ).to.have.been.calledWith(
    //   wallet1.address,
    //   await testCollateralToken.getAddress(),
    //   200,
    // );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10000000000000000"],
        ["7264161"],
      ),
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"), "10000000000000000");

    expect(
      await termAuctionBidLocker.lockedBid(getBytesHash("test-id-1")),
    ).to.deep.equal([
      getBytesHash("test-id-1"),
      wallet1.address,
      solidityPackedKeccak256(
        ["uint256", "uint256"],
        ["10000000000000000", "7264161"],
      ),
      10000000000000000n,
      300n,
      [200n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      false,
      ZeroAddress,
      true,
    ]);
  });
  it("editing a bid with more collateral locks user collateral", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "712612412",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["10000000000000000", "712612412"],
          ),
          amount: "600",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["800"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet1.address,
        solidityPackedKeccak256(
          ["uint256", "uint256"],
          ["10000000000000000", "712612412"],
        ),
        "600",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["800"],
        false,
        ZeroAddress,
        ZeroAddress,
      );

    // expect(
    //   termRepoCollateralManager.auctionLockCollateral,
    // ).to.have.been.calledWith(
    //   wallet1.address,
    //   await testCollateralToken.getAddress(),
    //   400,
    // );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10000000000000000"],
        ["712612412"],
      ),
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"), "10000000000000000");

    expect(
      await termAuctionBidLocker.lockedBid(getBytesHash("test-id-1")),
    ).to.deep.equal([
      getBytesHash("test-id-1"),
      wallet1.address,
      solidityPackedKeccak256(
        ["uint256", "uint256"],
        ["10000000000000000", "712612412"],
      ),
      10000000000000000n,
      600n,
      [800n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      false,
      ZeroAddress,
      true,
    ]);
  });
  it("locking a new bid with the same input id reverts", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    // await termRepoCollateralManager.mock.initialCollateralRatios.returns("1");
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });

    await termAuctionBidLocker.connect(wallet1).lockBids([
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
        amount: "10000",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["10000"],
        collateralTokens: [await testCollateralToken.getAddress()],
      },
    ]);

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "10000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["10000"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        "GeneratingExistingBid",
      )
      .withArgs(
        await getGeneratedTenderId(
          getBytesHash("test-id-1"),
          termAuctionBidLocker,
          wallet1,
        ),
      );
  });

  it("lockBidsWithReferral with bidder parameter takes collateral from router and saves bids", async () => {
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();

    const block = await ethers.provider.getBlock("latest");
    const currentBlockTime = block!.timestamp;
    await termAuctionBidLocker.setStartTime(currentBlockTime - 600);
    await termAuctionBidLocker.setRevealTime(currentBlockTime + 600);

    const testId1Id = await getGeneratedTenderId(
      getBytesHash("test-id-1"),
      termAuctionBidLocker,
      wallet1,
    );

    // Router (termDiamond) locks bids on behalf of wallet1
    await expect(
      termAuctionBidLocker.connect(termDiamond)["lockBidsWithReferral(address,(bytes32,address,bytes32,uint256,uint256[],address,address[])[],address)"](
        wallet1.address,
        [
          {
            id: getBytesHash("test-id-1"),
            bidder: wallet1.address,
            bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
            amount: "2000",
            purchaseToken: await testBorrowedToken.getAddress(),
            collateralAmounts: [10000000n],
            collateralTokens: [await testCollateralToken.getAddress()],
          },
        ],
        ZeroAddress

      ),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId1Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256"], ["15000000"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        [10000000n],
        false,
        ZeroAddress,
        ZeroAddress,
      );
  });

  it("lockBids with bidder parameter reverts if not called by DIAMOND_ROLE", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1)["lockBidsWithReferral(address,(bytes32,address,bytes32,uint256,uint256[],address,address[])[],address)"](
        wallet1.address,
        [
          {
            id: getBytesHash("test-id-9"),
            bidder: wallet1.address,
            bidPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["20", "5555555"],
            ),
            amount: "2000",
            collateralAmounts: [10000000n],
            purchaseToken: await testBorrowedToken.getAddress(),
            collateralTokens: [await testCollateralToken.getAddress()],
          },
        ],
        ZeroAddress,
      ),
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "AccessControlUnauthorizedAccount");
  });

  it("unlockBids with bidder parameter returns collateral and unlocks bids", async () => {
    await termRepoCollateralManager.mock.auctionUnlockCollateral.returns();
    
    // Add a bid using the test helper
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-10"),
        bidder: wallet2.address,
        bidPriceRevealed: "10",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "123456",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    // Unlock bid via diamond role (msg.sender = termDiamond, bidder = wallet2)
    await expect(
      termAuctionBidLocker
        .connect(termDiamond)["unlockBids(address,bytes32[])"](wallet2.address, [getBytesHash("test-id-10")]),
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-10"));

    const unlockedBid = await termAuctionBidLocker.lockedBid(getBytesHash("test-id-10"));
    expect(unlockedBid[4]).to.equal(0n); // amount should be 0 (deleted)
  });

  it("unlockBids with bidder parameter reverts if not called by DIAMOND_ROLE", async () => {
    // Add a bid using the test helper
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-11"),
        bidder: wallet2.address,
        bidPriceRevealed: "10",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "123456",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    // Try to unlock from non-diamond address (should fail access control)
    await expect(
      termAuctionBidLocker
        .connect(wallet1)["unlockBids(address,bytes32[])"](wallet2.address, [getBytesHash("test-id-11")]),
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "AccessControlUnauthorizedAccount");
  });
});

describe("TermAuctionBidLocker", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let termDiamond: SignerWithAddress;

  let termAuction: SignerWithAddress;
  let previousTermRepoRolloverManager: SignerWithAddress;
  let testCollateralToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let testBorrowedToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let testUnapprovedToken: MockContract<ERC20Upgradeable> & ERC20Upgradeable;
  let termOracle: MockContract<TermPriceConsumerV3> & TermPriceConsumerV3;
  let termEventEmitter: TermEventEmitter;
  let termAuctionBidLocker: TestingTermAuctionBidLocker &
    TestingTermAuctionBidLocker;
  let termRepoCollateralManager: MockContract<TermRepoCollateralManager> &
    ITermRepoCollateralManager;
  let pairOffTermRepoCollateralManager: MockContract<ITermRepoCollateralManager> &
    ITermRepoCollateralManager;
  let termRepoServicer: MockContract<TermRepoServicer> & TermRepoServicer;
  let termController: MockContract<TermController> & TermController;
  let pairOffTermRepoServicer: MockContract<TermRepoServicer> &
    TermRepoServicer;

  let termIdString: string;

  let auctionIdString: string;
  let auctionIdHash: string;

  let snapshotId: any;
  let expectedVersion: string;

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");

    upgrades.silenceWarnings();

    [
      wallet1,
      wallet2,
      wallet3,
      termInitializer,
      devopsMultisig,
      adminWallet,
      termAuction,
      previousTermRepoRolloverManager,
      termDiamond,
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet3.address, termInitializer.address, adminWallet.address, termDiamond.address],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    testCollateralToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    testBorrowedToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    testUnapprovedToken = await deployMockContract<ERC20Upgradeable>(
      wallet1,
      ERC20Upgradeable__factory.abi,
    );
    termController = await deployMockContract<TermController>(
      wallet1,
      TermController__factory.abi,
    );  

    await termController.mock.termContractsPaused.returns(false);

    pairOffTermRepoCollateralManager =
      await deployMockContract<TermRepoCollateralManager>(
        wallet1,
        TermRepoCollateralManager__factory.abi,
      );

    termRepoCollateralManager =
      await deployMockContract<TermRepoCollateralManager>(
        wallet1,
        TermRepoCollateralManager__factory.abi,
      );
    await termRepoCollateralManager.mock.initialCollateralRatios.returns(
      115n * 10n ** 16n,
    );
    await termRepoCollateralManager.mock.maintenanceCollateralRatios.returns(
      110n * 10n ** 16n,
    );

    termRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );

    pairOffTermRepoServicer = await deployMockContract<TermRepoServicer>(
      wallet1,
      TermRepoServicer__factory.abi,
    );
    await termRepoServicer.mock.servicingFee.returns("1" + "0".repeat(17));
    await termRepoServicer.mock.termController.returns(await termController.getAddress());
    await pairOffTermRepoServicer.mock.termRepoCollateralManager.returns(
      await pairOffTermRepoCollateralManager.getAddress(),
    );

    termOracle = await deployMockContract<TermPriceConsumerV3>(
      wallet1,
      TermPriceConsumerV3__factory.abi,
    );

    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker",
    );

    const currentTimestamp = dayjs();

    termIdString = "termIdString";

    auctionIdString = "auctionIdString";

    termAuctionBidLocker = (await upgrades.deployProxy(
      termAuctionBidLockerFactory,
      [
        termIdString,
        auctionIdString,
        BigInt(currentTimestamp.subtract(10, "hours").unix()),
        BigInt(currentTimestamp.add(10, "hour").unix()),
        BigInt(currentTimestamp.add(20, "hours").unix()),
        BigInt(currentTimestamp.add(10, "day").unix()),
        100n,
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termAuctionBidLocker.getAddress());

    auctionIdHash = solidityPackedKeccak256(["string"], [auctionIdString]);

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairTermContracts(
          termAuction.address,
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await termOracle.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address

        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AccessControlUnauthorizedAccount",
    );

    await termAuctionBidLocker
      .connect(termInitializer)
      .pairTermContracts(
        termAuction.address,
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        await termRepoCollateralManager.getAddress(),
        await termOracle.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
        termDiamond.address
      );

    await expect(
      termAuctionBidLocker
        .connect(termInitializer)
        .pairTermContracts(
          termAuction.address,
          await termRepoServicer.getAddress(),
          await termEventEmitter.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await termOracle.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address
        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AlreadyTermContractPaired",
    );

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairRolloverManager(previousTermRepoRolloverManager.address),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AccessControlUnauthorizedAccount",
    );
    
    await termAuctionBidLocker
      .connect(adminWallet)
      .pairRolloverManager(previousTermRepoRolloverManager.address);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("initialize reverts if start is after reveal time", async () => {
    const auctionStartTime = dayjs().add(2, "hours").unix();
    const revealTime = dayjs().add(1, "hour").unix();
    const auctionEndTime = dayjs().add(3, "hours").unix();
    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker",
    );
    await expect(
      upgrades.deployProxy(
        termAuctionBidLockerFactory,
        [
          termIdString,
          auctionIdString,
          auctionStartTime,
          revealTime,
          auctionEndTime,
          "2",
          dayjs().add(1, "day").unix(),
          await testBorrowedToken.getAddress(),
          [await testCollateralToken.getAddress()],
          termInitializer.address,
        ],
        { kind: "uups" },
      ),
    )
      .to.be.revertedWithCustomError(
        {
          interface: termAuctionBidLockerFactory.interface,
        },
        `AuctionStartsAfterReveal`,
      )
      .withArgs(auctionStartTime, revealTime);
  });
  it("pairTermContracts reverts if servicer address is null", async () => {
    const auctionStartTime = dayjs().add(1, "hour").unix();
    const revealTime = dayjs().add(2, "hours").unix();
    const auctionEndTime = dayjs().add(3, "hours").unix();
    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker",
    );

    const termAuctionBidLockerPairRevert = (await upgrades.deployProxy(
      termAuctionBidLockerFactory,
      [
        termIdString,
        auctionIdString,
        auctionStartTime,
        revealTime,
        auctionEndTime,
        dayjs().add(1, "day").unix(),
        "2",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termAuctionBidLockerPairRevert.getAddress());
    await expect(
      termAuctionBidLockerPairRevert
        .connect(termInitializer)
        .pairTermContracts(
          termAuction.address,
          ZeroAddress,
          await termEventEmitter.getAddress(),
          await termRepoCollateralManager.getAddress(),
          await termOracle.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address
        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLockerPairRevert,
      "InvalidTermRepoServicer",
    );
  });

  it("getAllBids (with empty expired rollovers and nonempty revealed/nonrevealed) reverts when missing bids and successfully decrements bid counter when input calldata complete", async () => {
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 9n });
    await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
      BigInt(dayjs().add(2, "hour").unix()),
    );
    await pairOffTermRepoServicer.mock.getBorrowerRepurchaseObligation.returns(
      0n,
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "12345",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "412838",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "50",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
      },
      "781981",
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await termAuctionBidLocker.revealBids(
      [getBytesHash("test-id-1")],
      ["10"],
      ["12345"],
    );

    // rollover not expired
    // await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
    //   dayjs().add(2, "hour").unix().toString(),
    // );
    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1"), getBytesHash("test-id-3")],
          [],
          [],
        ),
    )
      .to.be.revertedWithCustomError(
termAuctionBidLocker, "BidCountIncorrect")
      .withArgs(3);

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-0"), getBytesHash("test-id-3")],
          [],
          [getBytesHash("test-id-2")],
        ),
    )
      .to.be.revertedWithCustomError(
termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-0"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
          [],
        ),
    )
      .to.be.revertedWithCustomError(
termAuctionBidLocker, `NonRolloverBid`)
      .withArgs(getBytesHash("test-id-2"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-3")],
          [getBytesHash("test-id-2")],
        ),
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `NonExpiredRolloverBid`,
      )
      .withArgs(getBytesHash("test-id-3"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [
            getBytesHash("test-id-2"),
            getBytesHash("test-id-1"),
            getBytesHash("test-id-3"),
          ],
          [],
          [],
        ),
    )
      .to.be.revertedWithCustomError(
 termAuctionBidLocker, `BidNotRevealed`)
      .withArgs(getBytesHash("test-id-2"));
    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
        ),
    )
      .to.be.revertedWithCustomError(
   termAuctionBidLocker, `BidRevealed`)
      .withArgs(getBytesHash("test-id-3"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-3"), getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2")],
        ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "RevealedBidsNotSorted",
    );

    await termAuctionBidLocker
      .connect(termAuction)
      .getAllBids(
        [getBytesHash("test-id-1"), getBytesHash("test-id-3")],
        [],
        [getBytesHash("test-id-2")],
      );

    expect(await termAuctionBidLocker.getBidCount()).to.eq(0);
  });

  it("getAllBids returns correctly for rollover bid below borrower repurchase obligation", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
      },
      "71891",
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    // rollover not expired
    await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
      dayjs().add(2, "hour").unix().toString(),
    );

    // rollover bidder has less repurchase obligation than bid amount
    await pairOffTermRepoServicer.mock.getBorrowerRepurchaseObligation
      // .withArgs(wallet2.address)
      .returns(800n);

    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 9n });

    await pairOffTermRepoCollateralManager.mock.getCollateralBalances.returns(
      [await testCollateralToken.getAddress()],
      [500n],
    );

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids([getBytesHash("test-id-1")], [], []),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet2.address,
        solidityPackedKeccak256(["uint256", "uint256"], [3n, 71891n]),
        802n,
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        [500n],
        true,
        await pairOffTermRepoServicer.getAddress(),
        ZeroAddress,
      );
  });

  it("getAllBids returns correctly for partial rollover bid", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "440",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
      },
      "71891",
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    // rollover not expired
    await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
      BigInt(dayjs().add(2, "hour").unix()),
    );

    // rollover bidder has less repurchase obligation than bid amount
    await pairOffTermRepoServicer.mock.getBorrowerRepurchaseObligation
      // .withArgs(wallet2.address)
      .returns(878n);

    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 9n });

    await pairOffTermRepoCollateralManager.mock.getCollateralBalances.returns(
      [await testCollateralToken.getAddress()],
      [600n],
    );

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids([getBytesHash("test-id-1")], [], []),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet2.address,
        solidityPackedKeccak256(["uint256", "uint256"], [3n, 71891n]),
        440n,
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        [300n],
        true,
        await pairOffTermRepoServicer.getAddress(),
        ZeroAddress,
      );
  });

  it("getAllBids returns correctly for rollover bid with zero borrower repurchase obligations", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
      },
      "71891",
    );
    await termAuctionBidLocker.setRevealTime(
      BigInt(dayjs().subtract(1, "hour").unix()),
    );

    // rollover not expired
    await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
      BigInt(dayjs().add(2, "hour").unix()),
    );

    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 9n });

    // rollover bidder has less repurchase obligation than bid amount
    await pairOffTermRepoServicer.mock.getBorrowerRepurchaseObligation
      // .withArgs(wallet2.address)
      .returns(0n);

    await termAuctionBidLocker.testGetAllBids(
      [getBytesHash("test-id-1")],
      [],
      [],
    );

    expect((await termAuctionBidLocker.bidsToUnlock(0))[0]).to.deep.eq(
      getBytesHash("test-id-1"),
    );
  });

  it("getAllBids returns correctly for empty revealed and nonempty nonrevealed bids", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
      },
      "71891",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "18190",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "130848",
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    // rollover expired
    await pairOffTermRepoServicer.mock.endOfRepurchaseWindow.returns(
      dayjs().subtract(2, "hour").unix().toString(),
    );

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
        ),
    )
      .to.be.revertedWithCustomError(
 termAuctionBidLocker, `RolloverBidExpired`)
      .withArgs(getBytesHash("test-id-1"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [],
          [getBytesHash("test-id-4")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
        ),
    )
      .to.be.revertedWithCustomError(
  termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-4"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [],
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-4")],
        ),
    )
      .to.be.revertedWithCustomError(
termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-4"));

    await termAuctionBidLocker
      .connect(termAuction)
      .getAllBids(
        [],
        [getBytesHash("test-id-1")],
        [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
      );
    expect(await termAuctionBidLocker.getBidCount()).to.eq(0);
  });

  it("unlockBids returns collateral and unlocks a user's bids", async () => {
    await termRepoCollateralManager.mock.auctionUnlockCollateral.returns();
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "123123",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "12310",
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "9778",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet3)
        .unlockBids([getBytesHash("test-id-3")]),
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-3"));

    // expect(
    //   await termRepoCollateralManager.mock.auctionUnlockCollateral
    //     // .atCall(0)
    //     .withArgs(
    //       wallet3.address,
    //       await testCollateralToken.getAddress(),
    //       BigInt("1000"),
    //     ),
    // ).to.be.true;

    expect(
      await termAuctionBidLocker.lockedBid(getBytesHash("test-id-3")),
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0n,
      0n,
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      ZeroAddress,
      false,
    ]);
  });

  it("lockBidsWithReferral reverts if submitter refers themself", async () => {
    await termRepoCollateralManager.mock.auctionLockCollateral.returns();
    // await termRepoCollateralManager.mock.initialCollateralRatios.returns(1n);
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet2).lockBidsWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            bidder: wallet1.address,
            bidPriceHash: solidityPackedKeccak256(["uint256"], ["15"]),
            amount: "2000",
            collateralAmounts: ["1000"],
            purchaseToken: await testBorrowedToken.getAddress(),
            collateralTokens: [await testCollateralToken.getAddress()],
          },
        ],
        wallet2.address,
      ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "InvalidSelfReferral",
    );
  });

  it("lockRolloverBid succeeds initially, edit succeeds, and then deletion", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "12941294",
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], ["50"]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: "50",
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        solidityPackedKeccak256(["uint256"], ["50"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["1000"],
        true,
        await pairOffTermRepoServicer.getAddress(),
        ZeroAddress,
      );

    expect(await termAuctionBidLocker.lockedBid(testRolloverId)).to.deep.equal([
      testRolloverId,
      wallet1.address,
      nonCompBidPrice,
      50n,
      2000n,
      [1000n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      true,
      await pairOffTermRepoServicer.getAddress(),
      true,
    ]);

    expect(await termAuctionBidLocker.getBidCount()).to.eq(2);

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: "50",
          amount: "3000",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        solidityPackedKeccak256(["uint256"], ["50"]),
        "3000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["1000"],
        true,
        await pairOffTermRepoServicer.getAddress(),
        ZeroAddress,
      );

    expect(await termAuctionBidLocker.lockedBid(testRolloverId)).to.deep.equal([
      testRolloverId,
      wallet1.address,
      nonCompBidPrice,
      50n,
      3000n,
      [1000n],
      await testBorrowedToken.getAddress(),
      [await testCollateralToken.getAddress()],
      true,
      await pairOffTermRepoServicer.getAddress(),
      true,
    ]);

    expect(await termAuctionBidLocker.getBidCount()).to.eq(2);

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: "50",
          amount: "0",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, testRolloverId);

    expect((await termAuctionBidLocker.lockedBid(testRolloverId)).amount).to.eq(
      0,
    );

    expect(await termAuctionBidLocker.getBidCount()).to.eq(1);

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: "50",
          amount: "0",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.be.revertedWithCustomError(
  termAuctionBidLocker, "NonExistentBid")
      .withArgs(testRolloverId);

    expect(await termAuctionBidLocker.getBidCount()).to.eq(1);
  });
  it("lockRolloverBid deletion doesn't change bidCount if bid doesn't exist", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "12941294",
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], ["50"]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: "50",
          amount: "0",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.be.revertedWithCustomError(
  termAuctionBidLocker, "NonExistentBid")
      .withArgs(testRolloverId);

    expect(await termAuctionBidLocker.getBidCount()).to.eq(1);
  });
  it("lockRolloverBid does not lock if bid is not a rollover", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "12312877143",
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], [MaxUint256]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: MaxUint256,
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: false,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    ).to.be.revertedWithCustomError(
   termAuctionBidLocker, "NonRolloverBid");

    expect(await termAuctionBidLocker.lockedBid(testRolloverId)).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0n,
      0n,
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      "0x0000000000000000000000000000000000000000",
      false,
    ]);
  });
  it("lockRolloverBid succeeds with amount below regular minimum but above rollover minimum", async () => {
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], [MaxUint256]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termAuctionBidLocker
      .connect(previousTermRepoRolloverManager)
      .lockRolloverBid({
        id: testRolloverId,
        bidder: wallet1.address,
        bidPriceHash: nonCompBidPrice,
        bidPriceRevealed: MaxUint256,
        amount: "50", // 50 < 100 (regular minimum) but 50 >= 10 (rollover minimum)
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
        isRevealed: true,
      });

    // Check that the bid was locked with the correct amounts
    const lockedBid = await termAuctionBidLocker.lockedBid(testRolloverId);
    expect(lockedBid[4]).to.equal("50"); // amount
    expect(lockedBid[5]).to.deep.equal(["1000"]); // collateralAmounts
    expect(lockedBid[0]).to.equal(testRolloverId); // id
    expect(lockedBid[1]).to.equal(wallet1.address); // bidder
  });
  it("lockRolloverBid succeeds with amount at exact rollover minimum", async () => {
    const testRolloverId = getBytesHash(`someterm-minimum-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], [MaxUint256]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termAuctionBidLocker
      .connect(previousTermRepoRolloverManager)
      .lockRolloverBid({
        id: testRolloverId,
        bidder: wallet1.address,
        bidPriceHash: nonCompBidPrice,
        bidPriceRevealed: MaxUint256,
        amount: "10", // Exactly at rollover minimum (minimumTenderAmount / MINIMUM_ROLLOVER_TENDER_DIVISOR = 100 / 10 = 10)
        collateralAmounts: ["1000"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer:
          await pairOffTermRepoServicer.getAddress(),
        isRevealed: true,
      });

    // Check that the bid was locked with the correct amounts
    const lockedBid = await termAuctionBidLocker.lockedBid(testRolloverId);
    expect(lockedBid[4]).to.equal("10"); // amount
    expect(lockedBid[5]).to.deep.equal(["1000"]); // collateralAmounts
    expect(lockedBid[0]).to.equal(testRolloverId); // id
    expect(lockedBid[1]).to.equal(wallet1.address); // bidder
  });
  it("lockRolloverBid fails with amount below rollover minimum", async () => {
    const testRolloverId = getBytesHash(`someterm-toolow-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], [MaxUint256]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: MaxUint256,
          amount: "5", // Below rollover minimum (5 < 10)
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.be.revertedWithCustomError(
    termAuctionBidLocker, "BidAmountTooLow")
      .withArgs("5");

    expect(await termAuctionBidLocker.lockedBid(testRolloverId)).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0n,
      0n,
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      "0x0000000000000000000000000000000000000000",
      false,
    ]);
  });
  it("lockRolloverBid does not lock if bid purchase token does not match locker", async () => {
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = solidityPackedKeccak256(["uint256"], [MaxUint256]);

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: MaxUint256,
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: await testUnapprovedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "InvalidPurchaseToken",
    );

    expect(await termAuctionBidLocker.lockedBid(testRolloverId)).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0n,
      0n,
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      "0x0000000000000000000000000000000000000000",
      false,
    ]);
  });
  it("lockRolloverBid does lock if bid is in shortfall", async () => {
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);

    await termRepoCollateralManager.mock.initialCollateralRatios.returns(
      "10000000000000000000",
    );
    await termOracle.mock.usdValueOfTokens.returns({ mantissa: "10" });

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          bidPriceRevealed: "15000000",
          amount: "2000",
          collateralAmounts: ["1"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        solidityPackedKeccak256(["uint256"], ["15000000"]),
        "2000",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        ["1"],
        true,
        await pairOffTermRepoServicer.getAddress(),
        ZeroAddress,
      );
  });
  it("revealing bid with high price fails", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "20000000000000000000000",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "1249913",
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["20000000000000000000000"],
        ["1249913"],
      ),
    )
      .to.be.revertedWithCustomError(
     termAuctionBidLocker, `TenderPriceTooHigh`)
      .withArgs(getBytesHash("test-id-1"), "100000000000000000000");
  });
  it("locking bid before auction is open reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().add(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(2, "minute").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["10"]),
          amount: "500",
          collateralAmounts: ["400"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(
     termAuctionBidLocker, "AuctionNotOpen");
  });
  it("locking bid after auction is closed reverts", async () => {
    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(2, "minute").unix(),
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["10"]),
          amount: "500",
          collateralAmounts: ["400"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(
   termAuctionBidLocker, "AuctionNotOpen");
  });
  it("revealing bid before auction is revealing reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "124192412",
    );

    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(2, "minute").unix(),
    );
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10"],
        ["124192412"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AuctionNotRevealing",
    );
  });
  it("editing a bid owned by a different user reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5818591",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet2).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet2.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1000"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(
    termAuctionBidLocker, "BidNotOwned");
  });
  it("editing an existing bid with reordered collateral tokens reverts", async () => {
    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker",
    );

    const currentTimestamp = dayjs();
    const termAuctionBidLockerWithTwoCollateralTokens = (await upgrades.deployProxy(
      termAuctionBidLockerFactory,
      [
        termIdString,
        auctionIdString,
        BigInt(currentTimestamp.subtract(10, "hours").unix()),
        BigInt(currentTimestamp.add(10, "hour").unix()),
        BigInt(currentTimestamp.add(20, "hours").unix()),
        BigInt(currentTimestamp.add(10, "day").unix()),
        100n,
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress(), await testBorrowedToken.getAddress()],
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termAuctionBidLockerWithTwoCollateralTokens.getAddress());

    await termAuctionBidLockerWithTwoCollateralTokens
      .connect(termInitializer)
      .pairTermContracts(
        termAuction.address,
        await termRepoServicer.getAddress(),
        await termEventEmitter.getAddress(),
        await termRepoCollateralManager.getAddress(),
        await termOracle.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
        termDiamond.address,
      );

    await termAuctionBidLockerWithTwoCollateralTokens.addBid(
      {
        id: getBytesHash("test-id-ordered-collateral"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400", "500"],
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralTokens: [
          await testCollateralToken.getAddress(),
          await testBorrowedToken.getAddress(),
        ],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5818591",
    );

    await termAuctionBidLockerWithTwoCollateralTokens.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionBidLockerWithTwoCollateralTokens.setRevealTime(
      dayjs().add(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLockerWithTwoCollateralTokens.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-ordered-collateral"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1000", "2000"],
          collateralTokens: [
            await testBorrowedToken.getAddress(),
            await testCollateralToken.getAddress(),
          ],
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLockerWithTwoCollateralTokens,
        "CollateralTokenMismatch",
      )
      .withArgs(
        await testCollateralToken.getAddress(),
        await testBorrowedToken.getAddress(),
      );
  });
  it("locking a bid with an unapproved purchase token fails", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testUnapprovedToken.getAddress(),
          collateralAmounts: ["1000"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `PurchaseTokenNotApproved`,
      )
      .withArgs(await testUnapprovedToken.getAddress());
  });

  it("locking a bid gets rejected if max bid count is reached", async () => {
    await termAuctionBidLocker.setBidCount(1000);

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1000"],
          collateralTokens: [await testBorrowedToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(
  termAuctionBidLocker, `MaxBidCountReached`);
  });
  it("locking a rollover bid reverts if max bid count reached", async () => {
    await termAuctionBidLocker.setBidCount(1000);

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ZeroHash,
          bidPriceRevealed: "50",
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralTokens: [await testCollateralToken.getAddress()],
          isRollover: true,
          rolloverPairOffTermRepoServicer:
            await pairOffTermRepoServicer.getAddress(),
          isRevealed: true,
        }),
    ).to.be.revertedWithCustomError(
     termAuctionBidLocker, "MaxBidCountReached");
    expect(await termAuctionBidLocker.bidCount()).to.eq(1000);
  });
  it("locking a bid with an unapproved collateral token fails", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1000"],
          collateralTokens: [await testUnapprovedToken.getAddress()],
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `CollateralTokenNotApproved`,
      )
      .withArgs(await testUnapprovedToken.getAddress());
  });

  it("unlocking a bid with a different wallet reverts (unlockBid)", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "81285128",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(
     termAuctionBidLocker, "BidNotOwned");
  });
  it("unlocking a rollover bid reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: true,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "5758281",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(
    termAuctionBidLocker, "RolloverBid");
  });
  it("unlocking an bid with a different wallet reverts (unlockBids)", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "7258125",
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(
     termAuctionBidLocker, "BidNotOwned");
  });
  it("unlocking nonexistent bids reverts", async () => {
    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(
     termAuctionBidLocker, "NonExistentBid");
  });
  it("revealing a bid with a modified price reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "7518921",
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["11"],
        ["7518921"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker, "BidPriceModified");
  });
  it("reverts when an unauthorized wallet tries to pause locking", async () => {
    await expect(termAuctionBidLocker.connect(wallet2).pauseLocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to unpause locking", async () => {
    await expect(termAuctionBidLocker.connect(wallet2).unpauseLocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to pause unlocking", async () => {
    await expect(termAuctionBidLocker.connect(wallet2).pauseUnlocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to unpause unlocking", async () => {
    await expect(termAuctionBidLocker.connect(wallet2).unpauseUnlocking()).to.be
      .reverted;
  });
  it("locking a bid with an amount too low reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termRepoCollateralManager.mock.initialCollateralRatios.returns("1");

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "1",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1000"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    )
      .to.be.revertedWithCustomError(
    termAuctionBidLocker, "BidAmountTooLow")
      .withArgs(1);
  });
  it("locking a bid with too little collateral reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termOracle.mock.usdValueOfTokens.returns({ mantissa: 10n ** 18n });

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: solidityPackedKeccak256(["uint256"], ["15000000"]),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
          collateralAmounts: ["1"],
          collateralTokens: [await testCollateralToken.getAddress()],
        },
      ]),
    ).to.be.revertedWithCustomError(

      termAuctionBidLocker,
      "CollateralAmountTooLow",
    );
  });
  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await expect(
      termAuctionBidLocker.connect(devopsMultisig).upgrade(wallet1.address),
    )
      .to.emit(termEventEmitter, "TermContractUpgraded")
      .withArgs(await termAuctionBidLocker.getAddress(), wallet1.address);

    await expect(
      termAuctionBidLocker.connect(wallet2).upgrade(wallet1.address),
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("revealing a bid with an invalid nonce reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "11",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
        collateralAmounts: ["400"],
        collateralTokens: [await testCollateralToken.getAddress()],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ZeroAddress,
      },
      "7518921",
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["11"],
        ["123456"],
      ),
    ).to.be.revertedWithCustomError(
 termAuctionBidLocker, "BidPriceModified");
  });
  it("version returns the current contract version", async () => {
    expect(await termAuctionBidLocker.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
