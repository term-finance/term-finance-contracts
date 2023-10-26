/* eslint-disable no-unused-expressions */
/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai, { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { FakeContract, MockContract, smock } from "@defi-wonderland/smock";
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
} from "../typechain-types";
import { BigNumber, constants } from "ethers";
import dayjs from "dayjs";
import { getBytesHash, getGeneratedTenderId } from "../utils/simulation-utils";

chai.use(smock.matchers);

describe("TermAuctionBidLocker", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;

  let termAuction: SignerWithAddress;
  let previousTermRepoRolloverManager: SignerWithAddress;
  let testCollateralToken: FakeContract<ERC20Upgradeable>;
  let testBorrowedToken: FakeContract<ERC20Upgradeable>;
  let testUnapprovedToken: FakeContract<ERC20Upgradeable>;
  let termOracle: FakeContract<TermPriceConsumerV3>;
  let termEventEmitter: TermEventEmitter;
  let termAuctionBidLocker: TestingTermAuctionBidLocker;
  let termRepoCollateralManager: FakeContract<TermRepoCollateralManager>;
  let pairOffTermRepoCollateralManager: MockContract<ITermRepoCollateralManager>;
  let termRepoServicer: FakeContract<TermRepoServicer>;
  let pairOffTermRepoServicer: MockContract<TermRepoServicer>;

  let termIdString: string;

  let auctionIdString: string;
  let auctionIdHash: string;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
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
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet3.address, termInitializer.address],
      { kind: "uups" }
    )) as TermEventEmitter;

    testCollateralToken = await smock.fake<ERC20Upgradeable>(
      "ERC20Upgradeable"
    );
    await testCollateralToken.deployed();
    testBorrowedToken = await smock.fake<ERC20Upgradeable>("ERC20Upgradeable");
    await testBorrowedToken.deployed();
    testUnapprovedToken = await smock.fake<ERC20Upgradeable>(
      "ERC20Upgradeable"
    );
    await testUnapprovedToken.deployed();

    const collatManagerFactory =
      await smock.mock<TermRepoCollateralManager__factory>(
        "TermRepoCollateralManager"
      );

    pairOffTermRepoCollateralManager = await collatManagerFactory.deploy();
    await pairOffTermRepoCollateralManager.deployed();
    termRepoCollateralManager = await smock.fake<TermRepoCollateralManager>(
      "TermRepoCollateralManager"
    );
    termRepoCollateralManager.initialCollateralRatios.returns(
      "115" + "0".repeat(16)
    );
    termRepoCollateralManager.maintenanceCollateralRatios.returns(
      "11" + "0".repeat(17)
    );

    termRepoServicer = await smock.fake<TermRepoServicer>("TermRepoServicer");
    await termRepoServicer.deployed();

    const repoServicerFactory = await smock.mock<TermRepoServicer__factory>(
      "TermRepoServicer"
    );

    pairOffTermRepoServicer = await repoServicerFactory.deploy();
    await pairOffTermRepoServicer.deployed();
    termRepoServicer.servicingFee.returns("1" + "0".repeat(17));
    pairOffTermRepoServicer.termRepoCollateralManager.returns(
      pairOffTermRepoCollateralManager.address
    );

    termOracle = await smock.fake<TermPriceConsumerV3>("TermPriceConsumerV3");
    await termOracle.deployed();

    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker"
    );

    const currentTimestamp = dayjs();

    termIdString = "termIdString";

    auctionIdString = "auctionIdString";

    termAuctionBidLocker = (await upgrades.deployProxy(
      termAuctionBidLockerFactory,
      [
        termIdString,
        auctionIdString,
        currentTimestamp.subtract(10, "hours").unix(),
        currentTimestamp.add(10, "hour").unix(),
        currentTimestamp.add(20, "hours").unix(),
        currentTimestamp.add(10, "day").unix(),
        "2",
        testBorrowedToken.address,
        [testCollateralToken.address],
        termInitializer.address,
      ],
      { kind: "uups" }
    )) as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termAuctionBidLocker.address);

    auctionIdHash = ethers.utils.solidityKeccak256(
      ["string"],
      [auctionIdString]
    );

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairTermContracts(
          termAuction.address,
          termRepoServicer.address,
          termEventEmitter.address,
          termRepoCollateralManager.address,
          termOracle.address,
          devopsMultisig.address,
          adminWallet.address
        )
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`
    );

    await termAuctionBidLocker
      .connect(termInitializer)
      .pairTermContracts(
        termAuction.address,
        termRepoServicer.address,
        termEventEmitter.address,
        termRepoCollateralManager.address,
        termOracle.address,
        devopsMultisig.address,
        adminWallet.address
      );

    await expect(
      termAuctionBidLocker
        .connect(termInitializer)
        .pairTermContracts(
          termAuction.address,
          termRepoServicer.address,
          termEventEmitter.address,
          termRepoCollateralManager.address,
          termOracle.address,
          devopsMultisig.address,
          adminWallet.address
        )
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AlreadyTermContractPaired"
    );

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .pairRolloverManager(previousTermRepoRolloverManager.address)
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`
    );
    await termAuctionBidLocker
      .connect(adminWallet)
      .pairRolloverManager(previousTermRepoRolloverManager.address);
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("initialize reverts if start is after reveal time", async () => {
    const auctionStartTime = dayjs().add(2, "hours").unix();
    const revealTime = dayjs().add(1, "hour").unix();
    const auctionEndTime = dayjs().add(3, "hours").unix();
    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker"
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
          testBorrowedToken.address,
          [testCollateralToken.address],
          termInitializer.address,
        ],
        { kind: "uups" }
      )
    )
      .to.be.revertedWithCustomError(
        {
          interface: termAuctionBidLockerFactory.interface,
        },
        `AuctionStartsAfterReveal`
      )
      .withArgs(auctionStartTime, revealTime);
  });
  it("pairTermContracts reverts if servicer address is null", async () => {
    const auctionStartTime = dayjs().add(1, "hour").unix();
    const revealTime = dayjs().add(2, "hours").unix();
    const auctionEndTime = dayjs().add(3, "hours").unix();
    const termAuctionBidLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionBidLocker"
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
        testBorrowedToken.address,
        [testCollateralToken.address],
        termInitializer.address,
      ],
      { kind: "uups" }
    )) as TestingTermAuctionBidLocker;

    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termAuctionBidLockerPairRevert.address);
    await expect(
      termAuctionBidLockerPairRevert
        .connect(termInitializer)
        .pairTermContracts(
          termAuction.address,
          ethers.constants.AddressZero,
          termEventEmitter.address,
          termRepoCollateralManager.address,
          termOracle.address,
          devopsMultisig.address,
          adminWallet.address
        )
    ).to.be.revertedWithCustomError(
      termAuctionBidLockerPairRevert,
      "InvalidTermRepoServicer"
    );
  });

  it("getAllBids (with empty expired rollovers and nonempty revealed/nonrevealed) reverts when missing bids and successfully decrements bid counter when input calldata complete", async () => {
    termRepoCollateralManager.initialCollateralRatios.returns(1);
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().subtract(2, "hour").unix()
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "12345"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "412838"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "50",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
      },
      "781981"
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await termAuctionBidLocker.revealBids(
      [getBytesHash("test-id-1")],
      ["10"],
      ["12345"]
    );

    // rollover not expired
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().add(2, "hour").unix().toString()
    );
    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1"), getBytesHash("test-id-3")],
          [],
          []
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, "BidCountIncorrect")
      .withArgs(3);

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-0"), getBytesHash("test-id-3")],
          [],
          [getBytesHash("test-id-2")]
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-0"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")],
          []
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `NonRolloverBid`)
      .withArgs(getBytesHash("test-id-2"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-3")],
          [getBytesHash("test-id-2")]
        )
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `NonExpiredRolloverBid`
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
          []
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `BidNotRevealed`)
      .withArgs(getBytesHash("test-id-2"));
    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")]
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `BidRevealed`)
      .withArgs(getBytesHash("test-id-3"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-3"), getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2")]
        )
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "RevealedBidsNotSorted"
    );

    await termAuctionBidLocker
      .connect(termAuction)
      .getAllBids(
        [getBytesHash("test-id-1"), getBytesHash("test-id-3")],
        [],
        [getBytesHash("test-id-2")]
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
      },
      "71891"
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    // rollover not expired
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().add(2, "hour").unix().toString()
    );

    // rollover bidder has less repurchase obligation than bid amount
    pairOffTermRepoServicer.getBorrowerRepurchaseObligation
      .whenCalledWith(wallet2.address)
      .returns("800");

    pairOffTermRepoCollateralManager.getCollateralBalances.returns([
      [testCollateralToken.address],
      ["500"],
    ]);

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids([getBytesHash("test-id-1")], [], [])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet2.address,
        ethers.utils.solidityKeccak256(["uint256", "uint256"], ["3", "71891"]),
        "802",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["500"],
        true,
        pairOffTermRepoServicer.address,
        ethers.constants.AddressZero
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
      },
      "71891"
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    // rollover not expired
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().add(2, "hour").unix().toString()
    );

    // rollover bidder has less repurchase obligation than bid amount
    pairOffTermRepoServicer.getBorrowerRepurchaseObligation
      .whenCalledWith(wallet2.address)
      .returns("878");

    pairOffTermRepoCollateralManager.getCollateralBalances.returns([
      [testCollateralToken.address],
      ["600"],
    ]);

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids([getBytesHash("test-id-1")], [], [])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet2.address,
        ethers.utils.solidityKeccak256(["uint256", "uint256"], ["3", "71891"]),
        "440",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["300"],
        true,
        pairOffTermRepoServicer.address,
        ethers.constants.AddressZero
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
      },
      "71891"
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    // rollover not expired
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().add(2, "hour").unix().toString()
    );

    // rollover bidder has less repurchase obligation than bid amount
    pairOffTermRepoServicer.getBorrowerRepurchaseObligation
      .whenCalledWith(wallet2.address)
      .returns("0");

    await termAuctionBidLocker.testGetAllBids(
      [getBytesHash("test-id-1")],
      [],
      []
    );

    expect(
      JSON.parse(JSON.stringify(await termAuctionBidLocker.bidsToUnlock(0)))[0]
    ).to.eq(getBytesHash("test-id-1"));
  });

  it("getAllBids returns correctly for empty revealed and nonempty nonrevealed bids", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
      },
      "71891"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "18190"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "130848"
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    // rollover expired
    pairOffTermRepoServicer.endOfRepurchaseWindow.returns(
      dayjs().subtract(2, "hour").unix().toString()
    );

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [getBytesHash("test-id-1")],
          [],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")]
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `RolloverBidExpired`)
      .withArgs(getBytesHash("test-id-1"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [],
          [getBytesHash("test-id-4")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-3")]
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-4"));

    await expect(
      termAuctionBidLocker
        .connect(termAuction)
        .getAllBids(
          [],
          [getBytesHash("test-id-1")],
          [getBytesHash("test-id-2"), getBytesHash("test-id-4")]
        )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `NonExistentBid`)
      .withArgs(getBytesHash("test-id-4"));

    await termAuctionBidLocker
      .connect(termAuction)
      .getAllBids(
        [],
        [getBytesHash("test-id-1")],
        [getBytesHash("test-id-2"), getBytesHash("test-id-3")]
      );
    expect(await termAuctionBidLocker.getBidCount()).to.eq(0);
  });

  it("unlockBids returns collateral and unlocks a user's bids", async () => {
    termRepoCollateralManager.auctionUnlockCollateral.returns();
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "123123"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "12310"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "9778"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet3)
        .unlockBids([getBytesHash("test-id-3")])
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-3"));

    expect(
      termRepoCollateralManager.auctionUnlockCollateral
        .atCall(0)
        .calledWith(
          wallet3.address,
          testCollateralToken.address,
          BigNumber.from("1000")
        )
    ).to.be.true;

    expect(
      JSON.parse(
        JSON.stringify(
          await termAuctionBidLocker.lockedBid(getBytesHash("test-id-3"))
        )
      )
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      BigNumber.from("0").toJSON(),
      BigNumber.from("0").toJSON(),
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      ethers.constants.AddressZero,
      false,
    ]);
  });

  it("lockBidsWithReferral takes collateral and saves a user's bid and emits a referral event", async () => {
    termRepoCollateralManager.auctionLockCollateral.returns();
    termRepoCollateralManager.initialCollateralRatios.returns(1);
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5772871823"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5772871823"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "8127525"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionBidLocker,
      wallet1
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBidsWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            bidder: wallet1.address,
            bidPriceHash: ethers.utils.solidityKeccak256(
              ["uint256", "uint256"],
              ["15", "88888888"]
            ),
            amount: "2000",
            collateralAmounts: ["1000"],
            purchaseToken: testBorrowedToken.address,
            collateralTokens: [testCollateralToken.address],
          },
        ],
        wallet2.address
      )
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        ethers.utils.solidityKeccak256(
          ["uint256", "uint256"],
          ["15", "88888888"]
        ),
        "2000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1000"],
        false,
        ethers.constants.AddressZero,
        wallet2.address
      );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids([testId7Id], ["15"], ["88888888"])
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testId7Id))
      )
    ).to.deep.equal([
      testId7Id,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0xa3214f1377ab073aaef1dab159d29eb40e5b8a6cd3d376375f6625687ffda283",
      BigNumber.from("15").toJSON(),
      BigNumber.from("2000").toJSON(),
      [BigNumber.from("1000").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      false,
      ethers.constants.AddressZero,
      true,
    ]);
  });

  it("lockBidsWithReferral reverts if submitter refers themself", async () => {
    termRepoCollateralManager.auctionLockCollateral.returns();
    termRepoCollateralManager.initialCollateralRatios.returns(1);
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet2).lockBidsWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            bidder: wallet1.address,
            bidPriceHash: ethers.utils.solidityKeccak256(["uint256"], ["15"]),
            amount: "2000",
            collateralAmounts: ["1000"],
            purchaseToken: testBorrowedToken.address,
            collateralTokens: [testCollateralToken.address],
          },
        ],
        wallet2.address
      )
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "InvalidSelfReferral"
    );
  });

  it("lockBids takes collateral and saves a user's bids", async () => {
    termRepoCollateralManager.auctionLockCollateral.returns();
    termRepoCollateralManager.initialCollateralRatios.returns(1);

    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5772871823"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-2"),
        bidder: wallet2.address,
        bidPriceRevealed: "3",
        amount: "1000",
        collateralAmounts: ["600"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5772871823"
    );
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-3"),
        bidder: wallet3.address,
        bidPriceRevealed: "8",
        amount: "2000",
        collateralAmounts: ["1000"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "812588125"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionBidLocker,
      wallet1
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-7"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256", "uint256"],
            ["15", "4444444"]
          ),
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        ethers.utils.solidityKeccak256(
          ["uint256", "uint256"],
          ["15", "4444444"]
        ),
        "2000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1000"],
        false,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids([testId7Id], ["15"], ["4444444"])
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testId7Id))
      )
    ).to.deep.equal([
      testId7Id,
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "0xe5326933fc206a73be2bb2beeebe6bfbe9574bd07543f0764d9cd0df1abf80a0",
      BigNumber.from("15").toJSON(),
      BigNumber.from("2000").toJSON(),
      [BigNumber.from("1000").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      false,
      ethers.constants.AddressZero,
      true,
    ]);
  });
  it("lockRolloverBid succeeds initially, edit succeeds, and then deletion", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "12941294"
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = ethers.utils.solidityKeccak256(["uint256"], ["50"]);

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
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        ethers.utils.solidityKeccak256(["uint256"], ["50"]),
        "2000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1000"],
        true,
        pairOffTermRepoServicer.address,
        ethers.constants.AddressZero
      );

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testRolloverId))
      )
    ).to.deep.equal([
      testRolloverId,
      wallet1.address,
      nonCompBidPrice,
      BigNumber.from("50").toJSON(),
      BigNumber.from("2000").toJSON(),
      [BigNumber.from("1000").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      true,
      pairOffTermRepoServicer.address,
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
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        ethers.utils.solidityKeccak256(["uint256"], ["50"]),
        "3000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1000"],
        true,
        pairOffTermRepoServicer.address,
        ethers.constants.AddressZero
      );

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testRolloverId))
      )
    ).to.deep.equal([
      testRolloverId,
      wallet1.address,
      nonCompBidPrice,
      BigNumber.from("50").toJSON(),
      BigNumber.from("3000").toJSON(),
      [BigNumber.from("1000").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      true,
      pairOffTermRepoServicer.address,
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
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, testRolloverId);

    expect((await termAuctionBidLocker.lockedBid(testRolloverId)).amount).to.eq(
      0
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
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, "NonExistentBid")
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "12941294"
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = ethers.utils.solidityKeccak256(["uint256"], ["50"]);

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
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, "NonExistentBid")
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "12312877143"
    );
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = ethers.utils.solidityKeccak256(
      ["uint256"],
      [ethers.constants.MaxUint256]
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: ethers.constants.MaxUint256,
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: false,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "NonRolloverBid");

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testRolloverId))
      )
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      BigNumber.from(0).toJSON(),
      BigNumber.from(0).toJSON(),
      [],
      "0x0000000000000000000000000000000000000000",
      [],
      false,
      "0x0000000000000000000000000000000000000000",
      false,
    ]);
  });
  it("lockRolloverBid does not lock if bid amount is too low", async () => {
    const testRolloverId = getBytesHash(`someterm-${wallet1.address}`);
    const nonCompBidPrice = ethers.utils.solidityKeccak256(
      ["uint256"],
      [ethers.constants.MaxUint256]
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: ethers.constants.MaxUint256,
          amount: "1",
          collateralAmounts: ["1000"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, "BidAmountTooLow")
      .withArgs("1");

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testRolloverId))
      )
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      BigNumber.from(0).toJSON(),
      BigNumber.from(0).toJSON(),
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
    const nonCompBidPrice = ethers.utils.solidityKeccak256(
      ["uint256"],
      [ethers.constants.MaxUint256]
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: nonCompBidPrice,
          bidPriceRevealed: ethers.constants.MaxUint256,
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: testUnapprovedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "InvalidPurchaseToken"
    );

    expect(
      JSON.parse(
        JSON.stringify(await termAuctionBidLocker.lockedBid(testRolloverId))
      )
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      BigNumber.from(0).toJSON(),
      BigNumber.from(0).toJSON(),
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

    termRepoCollateralManager.initialCollateralRatios.returns(
      "10000000000000000000"
    );
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: testRolloverId,
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          bidPriceRevealed: "15000000",
          amount: "2000",
          collateralAmounts: ["1"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testRolloverId,
        wallet1.address,
        ethers.utils.solidityKeccak256(["uint256"], ["15000000"]),
        "2000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1"],
        true,
        pairOffTermRepoServicer.address,
        ethers.constants.AddressZero
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "1249913"
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["20000000000000000000000"],
        ["1249913"]
      )
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, `TenderPriceTooHigh`)
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
          bidPriceHash: ethers.utils.solidityKeccak256(["uint256"], ["10"]),
          amount: "500",
          collateralAmounts: ["400"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "AuctionNotOpen");
  });
  it("locking bid after auction is closed reverts", async () => {
    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(2, "minute").unix()
    );
    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(["uint256"], ["10"]),
          amount: "500",
          collateralAmounts: ["400"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "AuctionNotOpen");
  });
  it("revealing bid before auction is revealing reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        collateralAmounts: ["400"],
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "124192412"
    );

    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(2, "minute").unix()
    );
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10"],
        ["124192412"]
      )
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "AuctionNotRevealing"
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
        purchaseToken: testBorrowedToken.address,
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5818591"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet2).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet2.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1000"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "BidNotOwned");
  });
  it("locking a bid with an unapproved purchase token fails", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testUnapprovedToken.address,
          collateralAmounts: ["1000"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `PurchaseTokenNotApproved`
      )
      .withArgs(testUnapprovedToken.address);
  });

  it("locking a bid gets rejected if max bid count is reached", async () => {
    await termAuctionBidLocker.setBidCount(1000);

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1000"],
          collateralTokens: [testBorrowedToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, `MaxBidCountReached`);
  });
  it("locking a rollover bid reverts if max bid count reached", async () => {
    await termAuctionBidLocker.setBidCount(1000);

    await expect(
      termAuctionBidLocker
        .connect(previousTermRepoRolloverManager)
        .lockRolloverBid({
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: constants.HashZero,
          bidPriceRevealed: "50",
          amount: "2000",
          collateralAmounts: ["1000"],
          purchaseToken: testBorrowedToken.address,
          collateralTokens: [testCollateralToken.address],
          isRollover: true,
          rolloverPairOffTermRepoServicer: pairOffTermRepoServicer.address,
          isRevealed: true,
        })
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "MaxBidCountReached");
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
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1000"],
          collateralTokens: [testUnapprovedToken.address],
        },
      ])
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        `CollateralTokenNotApproved`
      )
      .withArgs(testUnapprovedToken.address);
  });

  it("unlocking a bid with a different wallet reverts (unlockBid)", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "81285128"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "BidNotOwned");
  });
  it("unlocking a rollover bid reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: true,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "5758281"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "RolloverBid");
  });
  it("unlocking an bid with a different wallet reverts (unlockBids)", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "7258125"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "BidNotOwned");
  });
  it("unlocking nonexistent bids reverts", async () => {
    await expect(
      termAuctionBidLocker
        .connect(wallet2)
        .unlockBids([getBytesHash("test-id-1")])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "NonExistentBid");
  });
  it("revealing a bid with a modified price reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "10",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "7518921"
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["11"],
        ["7518921"]
      )
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "BidPriceModified");
  });
  it("can pause and unpause (lock)", async () => {
    termRepoCollateralManager.initialCollateralRatios.returns("10");
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(10, "minute").unix()
    );
    await termAuctionBidLocker.setRevealTime(dayjs().add(10, "minute").unix());

    await expect(
      termAuctionBidLocker.connect(adminWallet).pauseLocking()
    ).to.emit(termEventEmitter, "BidLockingPaused");
    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "LockingPaused");
    await expect(
      termAuctionBidLocker.connect(adminWallet).unpauseLocking()
    ).to.emit(termEventEmitter, "BidLockingUnpaused");
    const testId1Id = await getGeneratedTenderId(
      getBytesHash("test-id-1"),
      termAuctionBidLocker,
      wallet1
    );
    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        testId1Id,
        wallet1.address,
        ethers.utils.solidityKeccak256(["uint256"], ["15000000"]),
        "2000",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["1"],
        false,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      );
  });
  it("can pause and unpause (unlock)", async () => {
    termRepoCollateralManager.initialCollateralRatios.returns("10");
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000",
        amount: "2000",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["1"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "68247214"
    );

    await termAuctionBidLocker.setStartTime(
      dayjs().subtract(10, "minute").unix()
    );
    await termAuctionBidLocker.setRevealTime(dayjs().add(10, "minute").unix());

    await expect(
      termAuctionBidLocker.connect(adminWallet).pauseUnlocking()
    ).to.emit(termEventEmitter, "BidUnlockingPaused");
    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")])
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "UnlockingPaused");
    await expect(
      termAuctionBidLocker.connect(adminWallet).unpauseUnlocking()
    ).to.emit(termEventEmitter, "BidUnlockingUnpaused");
    await expect(
      termAuctionBidLocker
        .connect(wallet1)
        .unlockBids([getBytesHash("test-id-1")])
    )
      .to.emit(termEventEmitter, "BidUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"));
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
  it("locking a new bid with the same input id reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    termRepoCollateralManager.initialCollateralRatios.returns("1");

    await termAuctionBidLocker.connect(wallet1).lockBids([
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceHash: ethers.utils.solidityKeccak256(["uint256"], ["15000000"]),
        amount: "10000",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["10000"],
        collateralTokens: [testCollateralToken.address],
      },
    ]);

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "10000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["10000"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.be.revertedWithCustomError(
        termAuctionBidLocker,
        "GeneratingExistingBid"
      )
      .withArgs(
        await getGeneratedTenderId(
          getBytesHash("test-id-1"),
          termAuctionBidLocker,
          wallet1
        )
      );
  });
  it("locking a bid with an amount too low reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    termRepoCollateralManager.initialCollateralRatios.returns("1");

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "1",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1000"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.be.revertedWithCustomError(termAuctionBidLocker, "BidAmountTooLow")
      .withArgs(1);
  });
  it("locking a bid with too little collateral reverts", async () => {
    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    termRepoCollateralManager.initialCollateralRatios.returns(
      "10000000000000000000"
    );
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256"],
            ["15000000"]
          ),
          amount: "2000",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["1"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    ).to.be.revertedWithCustomError(
      termAuctionBidLocker,
      "CollateralAmountTooLow"
    );
  });
  it("editing a bid with less collateral unlocks user collateral", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000000000000",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "7264161"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    termRepoCollateralManager.initialCollateralRatios.returns("10");
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256", "uint256"],
            ["10000000000000000", "7264161"]
          ),
          amount: "300",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["200"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet1.address,
        ethers.utils.solidityKeccak256(
          ["uint256", "uint256"],
          ["10000000000000000", "7264161"]
        ),
        "300",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["200"],
        false,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      );
    expect(
      termRepoCollateralManager.auctionUnlockCollateral
    ).to.have.been.calledWith(
      wallet1.address,
      testCollateralToken.address,
      200
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10000000000000000"],
        ["7264161"]
      )
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"), "10000000000000000");

    expect(
      JSON.parse(
        JSON.stringify(
          await termAuctionBidLocker.lockedBid(getBytesHash("test-id-1"))
        )
      )
    ).to.deep.equal([
      getBytesHash("test-id-1"),
      wallet1.address,
      ethers.utils.solidityKeccak256(
        ["uint256", "uint256"],
        ["10000000000000000", "7264161"]
      ),
      BigNumber.from("10000000000000000").toJSON(),
      BigNumber.from("300").toJSON(),
      [BigNumber.from("200").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      false,
      ethers.constants.AddressZero,
      true,
    ]);
  });
  it("editing a bid with more collateral locks user collateral", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "15000000000000000",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "712612412"
    );

    await termAuctionBidLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionBidLocker.setRevealTime(dayjs().add(1, "hour").unix());

    termRepoCollateralManager.initialCollateralRatios.returns("10");
    termOracle.usdValueOfTokens.returns({ mantissa: "10" });

    await expect(
      termAuctionBidLocker.connect(wallet1).lockBids([
        {
          id: getBytesHash("test-id-1"),
          bidder: wallet1.address,
          bidPriceHash: ethers.utils.solidityKeccak256(
            ["uint256", "uint256"],
            ["10000000000000000", "712612412"]
          ),
          amount: "600",
          purchaseToken: testBorrowedToken.address,
          collateralAmounts: ["800"],
          collateralTokens: [testCollateralToken.address],
        },
      ])
    )
      .to.emit(termEventEmitter, "BidLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-1"),
        wallet1.address,
        ethers.utils.solidityKeccak256(
          ["uint256", "uint256"],
          ["10000000000000000", "712612412"]
        ),
        "600",
        testBorrowedToken.address,
        [testCollateralToken.address],
        ["800"],
        false,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero
      );

    expect(
      termRepoCollateralManager.auctionLockCollateral
    ).to.have.been.calledWith(
      wallet1.address,
      testCollateralToken.address,
      400
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["10000000000000000"],
        ["712612412"]
      )
    )
      .to.emit(termEventEmitter, "BidRevealed")
      .withArgs(auctionIdHash, getBytesHash("test-id-1"), "10000000000000000");

    expect(
      JSON.parse(
        JSON.stringify(
          await termAuctionBidLocker.lockedBid(getBytesHash("test-id-1"))
        )
      )
    ).to.deep.equal([
      getBytesHash("test-id-1"),
      wallet1.address,
      ethers.utils.solidityKeccak256(
        ["uint256", "uint256"],
        ["10000000000000000", "712612412"]
      ),
      BigNumber.from("10000000000000000").toJSON(),
      BigNumber.from("600").toJSON(),
      [BigNumber.from("800").toJSON()],
      testBorrowedToken.address,
      [testCollateralToken.address],
      false,
      ethers.constants.AddressZero,
      true,
    ]);
  });
  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await expect(
      termAuctionBidLocker.connect(devopsMultisig).upgrade(wallet1.address)
    )
      .to.emit(termEventEmitter, "TermContractUpgraded")
      .withArgs(termAuctionBidLocker.address, wallet1.address);

    await expect(
      termAuctionBidLocker.connect(wallet2).upgrade(wallet1.address)
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
    );
  });
  it("revealing a bid with an invalid nonce reverts", async () => {
    await termAuctionBidLocker.addBid(
      {
        id: getBytesHash("test-id-1"),
        bidder: wallet1.address,
        bidPriceRevealed: "11",
        amount: "500",
        purchaseToken: testBorrowedToken.address,
        collateralAmounts: ["400"],
        collateralTokens: [testCollateralToken.address],
        isRollover: false,
        rolloverPairOffTermRepoServicer: ethers.constants.AddressZero,
      },
      "7518921"
    );

    await termAuctionBidLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix()
    );

    await expect(
      termAuctionBidLocker.revealBids(
        [getBytesHash("test-id-1")],
        ["11"],
        ["123456"]
      )
    ).to.be.revertedWithCustomError(termAuctionBidLocker, "BidPriceModified");
  });
  it("version returns the current contract version", async () => {
    expect(await termAuctionBidLocker.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
