/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TermController,
  TermController__factory,
  TermEventEmitter,
  TermRepoServicer,
  TermRepoServicer__factory,
  TestingTermAuctionOfferLocker,
} from "../typechain-types";
import { getBytesHash, getGeneratedTenderId } from "../utils/simulation-utils";
import dayjs from "dayjs";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";
import { ZeroAddress, solidityPackedKeccak256 } from "ethers";

describe("TermAuctionOfferLocker", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let wallet3: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let auctionAddress: SignerWithAddress;
  let termDiamond: SignerWithAddress;
  let testCollateralToken: MockContract<ERC20Upgradeable>;
  let testBorrowedToken: MockContract<ERC20Upgradeable>;
  let testUnapprovedToken: MockContract<ERC20Upgradeable>;
  let termEventEmitter: TermEventEmitter;
  let termAuctionOfferLocker: TestingTermAuctionOfferLocker;
  let termRepoServicer: MockContract<TermRepoServicer>;
  let termController: MockContract<TermController>;

  let termIdString: string;

  let auctionIdString: string;
  let auctionIdHash: string;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    [
      wallet1,
      wallet2,
      wallet3,
      termInitializer,
      devopsMultisig,
      adminWallet,
      auctionAddress,
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
    await termEventEmitter.waitForDeployment();

    testCollateralToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    testBorrowedToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    testUnapprovedToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );

    await testCollateralToken.setup();
    await testBorrowedToken.setup();
    await testUnapprovedToken.setup();

    termRepoServicer = await deployMock<TermRepoServicer>(
      TermRepoServicer__factory.abi,
      wallet1
    );
     

    termController = await deployMock<TermController>(
      TermController__factory.abi,
      wallet1,
    );

    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();

    const termControllerInterface = TermController__factory.createInterface();

    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("termController"),
      inputs: [],
      outputs: [await termController.getAddress()],
      kind: "read",}
    );
    await termController.setup({
      abi: termControllerInterface.getFunction("termContractsPaused"),
      inputs: [],
      outputs: [false],
      kind: "read",}
    );


    const termAuctionOfferLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionOfferLocker",
    );

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    const currentTimestamp = dayjs.unix(timestampBefore);

    termIdString = "termIdString";

    auctionIdString = "auctionIdString";

    termAuctionOfferLocker = (await upgrades.deployProxy(
      termAuctionOfferLockerFactory,
      [
        termIdString,
        auctionIdString,
        currentTimestamp.subtract(10, "hours").unix(),
        currentTimestamp.add(10, "hour").unix(),
        currentTimestamp.add(20, "hours").unix(),
        "2",
        await testBorrowedToken.getAddress(),
        [await testCollateralToken.getAddress()],
        termInitializer.address,
      ],
      { kind: "uups" },
    )) as unknown as TestingTermAuctionOfferLocker;
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termAuctionOfferLocker.getAddress());

    auctionIdHash = solidityPackedKeccak256(["string"], [auctionIdString]);

    await expect(
      termAuctionOfferLocker
        .connect(wallet2)
        .pairTermContracts(
          auctionAddress.address,
          await termEventEmitter.getAddress(),
          await termRepoServicer.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address,
        ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "AccessControlUnauthorizedAccount",
    );

    await termAuctionOfferLocker
      .connect(termInitializer)
      .pairTermContracts(
        auctionAddress.address,
        await termEventEmitter.getAddress(),
        await termRepoServicer.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
        termDiamond.address,
      );

    await expect(
      termAuctionOfferLocker
        .connect(termInitializer)
        .pairTermContracts(
          auctionAddress.address,
          await termEventEmitter.getAddress(),
          await termRepoServicer.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
          termDiamond.address
        ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "AlreadyTermContractPaired",
    );
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  it("initialize reverts if start is after reveal time", async () => {
    await termRepoServicer.setup();

    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    const currentTimestamp = dayjs.unix(timestampBefore);
    const auctionStartTime = currentTimestamp.add(2, "hours").unix();
    const revealTime = currentTimestamp.add(1, "hour").unix();
    const auctionEndTime = currentTimestamp.add(3, "hours").unix();
    const termAuctionOfferLockerFactory = await ethers.getContractFactory(
      "TestingTermAuctionOfferLocker",
    );
    await expect(
      upgrades.deployProxy(
        termAuctionOfferLockerFactory,
        [
          termIdString,
          auctionIdString,
          auctionStartTime,
          revealTime,
          auctionEndTime,
          "2",
          await testBorrowedToken.getAddress(),
          [await testCollateralToken.getAddress()],
          termInitializer.address,
        ],
        { kind: "uups" },
      ),
    )
      .to.be.revertedWithCustomError(
        { interface: termAuctionOfferLockerFactory.interface },
        `AuctionStartsAfterReveal`,
      )
      .withArgs(auctionStartTime, revealTime);
  });

  it("getAllOffers nonempty revealed and nonrevealed offers", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-4"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-5"),
        offeror: wallet2.address,
        offerPriceRevealed: "3",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-6"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-7"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    const blockNumBefore = await ethers.provider.getBlockNumber();
    const blockBefore = await ethers.provider.getBlock(blockNumBefore);
    const timestampBefore = blockBefore?.timestamp!;
    const currentTimestamp = dayjs.unix(timestampBefore);

    await termAuctionOfferLocker.setRevealTime(
      currentTimestamp.subtract(2, "minute").unix(),
    );
    await termAuctionOfferLocker.setEndTime(
      currentTimestamp.subtract(1, "hour").unix(),
    );

    await termAuctionOfferLocker.revealOffers(
      [getBytesHash("test-id-4"), getBytesHash("test-id-7")],
      ["10", "8"],
      ["5555555555", "5555555555"],
    );

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [],
          [getBytesHash("test-id-5"), getBytesHash("test-id-6")],
        ),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        "OfferCountIncorrect",
      )
      .withArgs(4);

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [
            getBytesHash("test-id-7"),
            getBytesHash("test-id-4"),
            getBytesHash("test-id-4"),
          ],
          [getBytesHash("test-id-5")],
        ),
    )
      .to.be.revertedWithCustomError(termAuctionOfferLocker, `NonExistentOffer`)
      .withArgs(getBytesHash("test-id-4"));

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [getBytesHash("test-id-7"), getBytesHash("test-id-4")],
          [getBytesHash("test-id-5"), getBytesHash("test-id-4")],
        ),
    )
      .to.be.revertedWithCustomError(termAuctionOfferLocker, `NonExistentOffer`)
      .withArgs(getBytesHash("test-id-4"));

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [
            getBytesHash("test-id-7"),
            getBytesHash("test-id-4"),
            getBytesHash("test-id-5"),
          ],
          [getBytesHash("test-id-6")],
        ),
    )
      .to.be.revertedWithCustomError(termAuctionOfferLocker, `OfferNotRevealed`)
      .withArgs(getBytesHash("test-id-5"));

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [],
          [
            getBytesHash("test-id-4"),
            getBytesHash("test-id-5"),
            getBytesHash("test-id-6"),
            getBytesHash("test-id-7"),
          ],
        ),
    )
      .to.be.revertedWithCustomError(termAuctionOfferLocker, `OfferRevealed`)
      .withArgs(getBytesHash("test-id-4"));

    await expect(
      termAuctionOfferLocker
        .connect(auctionAddress)
        .getAllOffers(
          [getBytesHash("test-id-4"), getBytesHash("test-id-7")],
          [getBytesHash("test-id-5"), getBytesHash("test-id-6")],
        ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "RevealedOffersNotSorted",
    );

    await termAuctionOfferLocker
      .connect(auctionAddress)
      .getAllOffers(
        [getBytesHash("test-id-7"), getBytesHash("test-id-4")],
        [getBytesHash("test-id-5"), getBytesHash("test-id-6")],
      );

    expect(await termAuctionOfferLocker.getOfferCount()).to.eq(0);
  });

  it("unlockOffers returns collateral and unlocks a user's offers", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("unlockOfferAmount"),
      inputs: [wallet3.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-2"),
        offeror: wallet2.address,
        offerPriceRevealed: "3",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-3"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker
        .connect(wallet3)
        .unlockOffers([getBytesHash("test-id-3")]),
    )
      .to.emit(termEventEmitter, "OfferUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-3"));

    expect(
      await termAuctionOfferLocker.lockedOffer(getBytesHash("test-id-3")),
    ).to.deep.equal([
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000000000000000000000000000",
      0n,
      0n,
      "0x0000000000000000000000000000000000000000",
      false,
    ]);
  });

  it("lockOffersWithReferral takes collateral and saves a user's offer", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-4"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-5"),
        offeror: wallet2.address,
        offerPriceRevealed: "3",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-6"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionOfferLocker,
      wallet1,
    );

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffersWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            offeror: wallet1.address,
            offerPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["15", "5555555555"],
            ),
            amount: "2000",
            purchaseToken: await testBorrowedToken.getAddress(),
          },
        ],
        wallet2.address,
      ),
    )
      .to.emit(termEventEmitter, "OfferLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "5555555555"]),
        "2000",
        await testBorrowedToken.getAddress(),
        wallet2.address,
      );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers([testId7Id], ["15"], ["5555555555"]),
    )
      .to.emit(termEventEmitter, "OfferRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(await termAuctionOfferLocker.lockedOffer(testId7Id)).to.deep.equal([
      testId7Id,
      wallet1.address,
      "0x70b2c5791a2c71fef064fa74e2387d4940c2df8a1e86a4f24b641376ce7d51cc",
      15n,
      2000n,
      await testBorrowedToken.getAddress(),
      true,
    ]);
  });

  it("lockOffersWithReferral reverts if user refers themself", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(wallet2).lockOffersWithReferral(
        [
          {
            id: getBytesHash("test-id-7"),
            offeror: wallet1.address,
            offerPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["15", "5555555555"],
            ),
            amount: "2000",
            purchaseToken: await testBorrowedToken.getAddress(),
          },
        ],
        wallet2.address,
      ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "InvalidSelfReferral",
    );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );
  });

  it("lockOffers saves a user's offer", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-4"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-5"),
        offeror: wallet2.address,
        offerPriceRevealed: "3",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-6"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionOfferLocker,
      wallet1,
    );

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.emit(termEventEmitter, "OfferLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "5555555555"]),
        "2000",
        await testBorrowedToken.getAddress(),
        ZeroAddress,
      );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers([testId7Id], ["15"], ["5555555555"]),
    )
      .to.emit(termEventEmitter, "OfferRevealed")
      .withArgs(auctionIdHash, testId7Id, "15");

    expect(await termAuctionOfferLocker.lockedOffer(testId7Id)).to.deep.equal([
      testId7Id,
      wallet1.address,
      "0x70b2c5791a2c71fef064fa74e2387d4940c2df8a1e86a4f24b641376ce7d51cc",
      15n,
      2000n,
      await testBorrowedToken.getAddress(),
      true,
    ]);
  });
  it("revealing offer with high price fails", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "20000000000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-1")],
        ["20000000000000000000000"],
        ["5555555555"],
      ),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        `TenderPriceTooHigh`,
      )
      .withArgs(getBytesHash("test-id-1"), "100000000000000000000");
  });
  it("locking offer before auction is open reverts", async () => {
    await termAuctionOfferLocker.setStartTime(dayjs().add(1, "hour").unix());
    await termAuctionOfferLocker.setRevealTime(dayjs().add(2, "minute").unix());

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-1"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "AuctionNotOpen");
  });

  it("locking offer after auction is revealing reverts", async () => {
    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(2, "minute").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-1"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "AuctionNotOpen");
  });
  it("revealing offer before auction is revealing reverts", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "20000000000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(2, "minute").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-1")],
        ["20000000000000000000000"],
        ["5555555555"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "AuctionNotRevealing",
    );
  });
  it("editing an offer locks and unlocks the correct amount", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup(
      {
        abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
        inputs: [wallet2.address, wallet2.address, "1500"],
        outputs: [],
        kind: "read",
      },
      {
        abi: termRepoServicerInterface.getFunction("unlockOfferAmount"),
        inputs: [wallet2.address, "1800"],
        outputs: [],
        kind: "read",
      },
    );

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet2.address,
        offerPriceRevealed: "20000000000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await termAuctionOfferLocker.connect(wallet2).lockOffers([
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet2.address,
        offerPriceHash: solidityPackedKeccak256(
          ["uint256", "uint256"],
          ["15000000", "5555555555"],
        ),
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
    ]);
    // expect(termRepoServicer.lockOfferAmount).to.have.been.calledWith(
    //   wallet2.address,
    //   wallet2.address,
    //   1500,
    // );

    await termAuctionOfferLocker.connect(wallet2).lockOffers([
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet2.address,
        offerPriceHash: solidityPackedKeccak256(
          ["uint256", "uint256"],
          ["15000000", "5555555555"],
        ),
        amount: "200",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
    ]);

    // expect(termRepoServicer.unlockOfferAmount).to.have.been.calledWith(
    //   wallet2.address,
    //   wallet2.address,
    //   1800,
    // );
  });
  it("editing an offer owned by a different user reverts", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "20000000000000000000000",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.lockOffers([
        {
          id: getBytesHash("test-id-1"),
          offeror: wallet2.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15000000", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "OfferNotOwned");
  });
  it("locking an offer with an unapproved purchase token fails", async () => {
    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-1"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15000000", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testUnapprovedToken.getAddress(),
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        `PurchaseTokenNotApproved`,
      )
      .withArgs(await testUnapprovedToken.getAddress());
  });
  it("lockOffer returns collateral and edits a user's offer", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("unlockOfferAmount"),
      inputs: [wallet1.address, "300"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-4"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-5"),
        offeror: wallet2.address,
        offerPriceRevealed: "3",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-6"),
        offeror: wallet3.address,
        offerPriceRevealed: "8",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-4"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "200",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.emit(termEventEmitter, "OfferLocked")
      .withArgs(
        auctionIdHash,
        getBytesHash("test-id-4"),
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "5555555555"]),
        "200",
        await testBorrowedToken.getAddress(),
        ZeroAddress,
      );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-4")],
        ["15"],
        ["5555555555"],
      ),
    )
      .to.emit(termEventEmitter, "OfferRevealed")
      .withArgs(auctionIdHash, getBytesHash("test-id-4"), "15");

    await expect(
      await termAuctionOfferLocker.lockedOffer(getBytesHash("test-id-4")),
    ).to.deep.equal([
      getBytesHash("test-id-4"),
      wallet1.address,
      "0x70b2c5791a2c71fef064fa74e2387d4940c2df8a1e86a4f24b641376ce7d51cc",
      15n,
      200n,
      await testBorrowedToken.getAddress(),
      true,
    ]);
  });
  it("unlocking an offer with a different wallet reverts (unlockOffers)", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker
        .connect(wallet2)
        .unlockOffers([getBytesHash("test-id-1")]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "OfferNotOwned");
  });
  it("revealing an offer with a modified price reverts", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-1")],
        ["11"],
        ["5555555555"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "OfferPriceModified",
    );
  });
  it("locking an offer gets rejected if max offer count is reached", async () => {
    await termAuctionOfferLocker.setOfferCount(1000);

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "10000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      `MaxOfferCountReached`,
    );
  });
  it("locking offer with no amount fails", async () => {
    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "0",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        "OfferAmountTooLow",
      )
      .withArgs(0);
  });
  it("can pause and unpause (lock)", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(adminWallet).pauseLocking(),
    ).to.emit(termEventEmitter, "OfferLockingPaused");
    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "0",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "LockingPaused");
    await expect(
      termAuctionOfferLocker.connect(adminWallet).unpauseLocking(),
    ).to.emit(termEventEmitter, "OfferLockingUnpaused");
    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionOfferLocker,
      wallet1,
    );

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "2000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.emit(termEventEmitter, "OfferLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "5555555555"]),
        "2000",
        await testBorrowedToken.getAddress(),
        ZeroAddress,
      );
  });
  it("can pause and unpause (unlock)", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("unlockOfferAmount"),
      inputs: [wallet1.address, "1000"],
      outputs: [],
      kind: "read",
    });
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-7"),
        offeror: wallet1.address,
        offerPriceRevealed: "15",
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(adminWallet).pauseUnlocking(),
    ).to.emit(termEventEmitter, "OfferUnlockingPaused");
    await expect(
      termAuctionOfferLocker
        .connect(wallet1)
        .unlockOffers([getBytesHash("test-id-7")]),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "UnlockingPaused");
    await expect(
      termAuctionOfferLocker.connect(adminWallet).unpauseUnlocking(),
    ).to.emit(termEventEmitter, "OfferUnlockingUnpaused");
    await expect(
      termAuctionOfferLocker
        .connect(wallet1)
        .unlockOffers([getBytesHash("test-id-7")]),
    )
      .to.emit(termEventEmitter, "OfferUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-7"));
  });
  it("reverts when an unauthorized wallet tries to pause locking", async () => {
    await expect(termAuctionOfferLocker.connect(wallet2).pauseLocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to pause locking", async () => {
    await expect(termAuctionOfferLocker.connect(wallet2).unpauseLocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to pause unlocking", async () => {
    await expect(termAuctionOfferLocker.connect(wallet2).pauseUnlocking()).to.be
      .reverted;
  });
  it("reverts when an unauthorized wallet tries to pause unlocking", async () => {
    await expect(termAuctionOfferLocker.connect(wallet2).unpauseUnlocking()).to
      .be.reverted;
  });
  it("unlocking a non-existent offer reverts (unlockOffers)", async () => {
    await expect(
      termAuctionOfferLocker
        .connect(wallet1)
        .unlockOffers([getBytesHash("test-id-123")]),
    )
      .to.be.revertedWithCustomError(termAuctionOfferLocker, `NonExistentOffer`)
      .withArgs(getBytesHash("test-id-123"));
  });
  it("revealing an offer with a modified price reverts", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "10",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "5555555555",
    );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-1")],
        ["11"],
        ["5555555555"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "OfferPriceModified",
    );
  });
  it("locking offer with no amount fails", async () => {
    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "0",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        "OfferAmountTooLow",
      )
      .withArgs(0);
  });
  it("locking offer with too small amount fails", async () => {
    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "1",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        "OfferAmountTooLow",
      )
      .withArgs(1);
  });

  it("locking new offer with same id input reverts", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [wallet1.address, wallet1.address, "1000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.connect(wallet1).lockOffers([
      {
        id: getBytesHash("test-id-7"),
        offeror: wallet1.address,
        offerPriceHash: solidityPackedKeccak256(
          ["uint256", "uint256"],
          ["15", "5555555555"],
        ),
        amount: "1000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
    ]);

    await expect(
      termAuctionOfferLocker.connect(wallet1).lockOffers([
        {
          id: getBytesHash("test-id-7"),
          offeror: wallet1.address,
          offerPriceHash: solidityPackedKeccak256(
            ["uint256", "uint256"],
            ["15", "5555555555"],
          ),
          amount: "1000",
          purchaseToken: await testBorrowedToken.getAddress(),
        },
      ]),
    )
      .to.be.revertedWithCustomError(
        termAuctionOfferLocker,
        "GeneratingExistingOffer",
      )
      .withArgs(
        await getGeneratedTenderId(
          getBytesHash("test-id-7"),
          termAuctionOfferLocker,
          wallet1,
        ),
      );
  });
  it("upgrade succeeds with admin and reverted if called by somebody else", async () => {
    await expect(
      termAuctionOfferLocker.connect(devopsMultisig).upgrade(wallet1.address),
    )
      .to.emit(termEventEmitter, "TermContractUpgraded")
      .withArgs(await termAuctionOfferLocker.getAddress(), wallet1.address);

    await expect(
      termAuctionOfferLocker.connect(wallet2).upgrade(wallet1.address),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "AccessControlUnauthorizedAccount",
    );
  });
  it("revealing an offer with an invalid nonce reverts", async () => {
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-1"),
        offeror: wallet1.address,
        offerPriceRevealed: "11",
        amount: "500",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "456",
    );

    await termAuctionOfferLocker.setRevealTime(
      dayjs().subtract(1, "hour").unix(),
    );

    await expect(
      termAuctionOfferLocker.revealOffers(
        [getBytesHash("test-id-1")],
        ["11"],
        ["123"],
      ),
    ).to.be.revertedWithCustomError(
      termAuctionOfferLocker,
      "OfferPriceModified",
    );
  });

  it("lockOffers with offeror parameter takes purchase token from router and saves offers", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("lockOfferAmount"),
      inputs: [termDiamond.address, wallet1.address, "2000"],
      outputs: [],
      kind: "read",
    });

    await termAuctionOfferLocker.setStartTime(
      dayjs().subtract(1, "hour").unix(),
    );
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    const testId7Id = await getGeneratedTenderId(
      getBytesHash("test-id-7"),
      termAuctionOfferLocker,
      wallet1,
    );

    // Key difference: termDiamond (with DIAMOND_ROLE) calls lockOffers on behalf of wallet1
    // Purchase token should be taken from termDiamond (msg.sender), not wallet1 (offeror)
    await expect(
      termAuctionOfferLocker.connect(termDiamond)["lockOffersWithReferral(address,(bytes32,address,bytes32,uint256,address)[],address)"](
        wallet1.address,
        [
          {
            id: getBytesHash("test-id-7"),
            offeror: wallet1.address,
            offerPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["15", "5555555555"],
            ),
            amount: "2000",
            purchaseToken: await testBorrowedToken.getAddress(),
          },
        ],
        ZeroAddress,
      ),
    )
      .to.emit(termEventEmitter, "OfferLocked")
      .withArgs(
        auctionIdHash,
        testId7Id,
        wallet1.address,
        solidityPackedKeccak256(["uint256", "uint256"], ["15", "5555555555"]),
        "2000",
        await testBorrowedToken.getAddress(),
        ZeroAddress,
      );

    const lockedOffer = await termAuctionOfferLocker.lockedOffer(testId7Id);
    expect(lockedOffer[0]).to.equal(testId7Id); // id
    expect(lockedOffer[1]).to.equal(wallet1.address); // offeror
    expect(lockedOffer[4]).to.equal(2000n); // amount
  });

  it("lockOffersWithReferral with offeror parameter reverts if not called by DIAMOND_ROLE", async () => {
    await termAuctionOfferLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    await expect(
      termAuctionOfferLocker.connect(wallet1)["lockOffersWithReferral(address,(bytes32,address,bytes32,uint256,address)[],address)"](
        wallet1.address,
        [
          {
            id: getBytesHash("test-id-9"),
            offeror: wallet1.address,
            offerPriceHash: solidityPackedKeccak256(
              ["uint256", "uint256"],
              ["15", "5555555555"],
            ),
            amount: "2000",
            purchaseToken: await testBorrowedToken.getAddress(),
          },
        ],
        ZeroAddress
      ),
    ).to.be.revertedWithCustomError(termAuctionOfferLocker, "AccessControlUnauthorizedAccount");
  });

  it("unlockOffers with offeror parameter returns purchase token and unlocks offers", async () => {
    const termRepoServicerInterface =
      TermRepoServicer__factory.createInterface();
    await termRepoServicer.setup({
      abi: termRepoServicerInterface.getFunction("unlockOfferAmount"),
      inputs: [wallet2.address, "2000"],
      outputs: [],
      kind: "read",
    });

    // Add an offer using the test helper
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-10"),
        offeror: wallet2.address,
        offerPriceRevealed: "10",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "123456",
    );

    await termAuctionOfferLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    // Unlock offer via diamond role (msg.sender = termDiamond, offeror = wallet2)
    await expect(
      termAuctionOfferLocker
        .connect(termDiamond)["unlockOffers(address,bytes32[])"](wallet2.address, [getBytesHash("test-id-10")]),
    )
      .to.emit(termEventEmitter, "OfferUnlocked")
      .withArgs(auctionIdHash, getBytesHash("test-id-10"));

    expect(await termAuctionOfferLocker.getOfferCount()).to.eq(0);
  });

  it("unlockOffers with offeror parameter reverts if not called by DIAMOND_ROLE", async () => {
    // Add an offer using the test helper
    await termAuctionOfferLocker.addOffer(
      {
        id: getBytesHash("test-id-11"),
        offeror: wallet2.address,
        offerPriceRevealed: "10",
        amount: "2000",
        purchaseToken: await testBorrowedToken.getAddress(),
      },
      "123456",
    );

    await termAuctionOfferLocker.setStartTime(dayjs().subtract(1, "hour").unix());
    await termAuctionOfferLocker.setRevealTime(dayjs().add(1, "hour").unix());

    // Try to unlock from non-DIAMOND_ROLE account
    await expect(
      termAuctionOfferLocker
        .connect(wallet2)["unlockOffers(address,bytes32[])"](wallet2.address, [getBytesHash("test-id-11")]),
    ).to.be.reverted;
  });

  it("version returns the current contract version", async () => {
    expect(await termAuctionOfferLocker.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
