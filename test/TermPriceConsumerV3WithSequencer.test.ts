/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";

import {
  TestPriceFeed,
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TestTermPriceConsumerV3WithSequencer,
  AggregatorV3Interface__factory,
} from "../typechain-types";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";
import { ZeroAddress } from "ethers";
import dayjs from "dayjs";

describe("TermPriceConsumerV3WithSequencer", () => {
  let termRepoCollateralManager: SignerWithAddress;
  let newBidLocker: SignerWithAddress;

  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let devopsWallet: SignerWithAddress;

  let testCollateralToken: MockContract<ERC20Upgradeable>;
  let testCollateralToken2: MockContract<ERC20Upgradeable>;
  let testBorrowedToken: MockContract<ERC20Upgradeable>;
  let termOracle: TestTermPriceConsumerV3WithSequencer;
  let mockCollateralFeed: TestPriceFeed;
  let mockCollateralFeed2: TestPriceFeed;
  let mockCollateralFeed3: MockContract<TestPriceFeed>;
  let mockCollateralFeed4: TestPriceFeed;
  let mockCollateralFeed5: TestPriceFeed;
  let mockCollateralFeed6: MockContract<TestPriceFeed>;

  let mockSequencerFeed: TestPriceFeed;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    [termRepoCollateralManager, newBidLocker, wallet1, wallet2, devopsWallet] =
      await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();

    testCollateralToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    testCollateralToken2 = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    testBorrowedToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );

    await testCollateralToken.setup(
      {
        abi: testCollateralToken.interface.getFunction("decimals"),
        outputs: [18n],
        kind: "read",
      },
      {
        abi: testCollateralToken.interface.getFunction("symbol"),
        outputs: ["USDC"],
        kind: "read",
      },
    );
    await testCollateralToken2.setup(
      {
        abi: testCollateralToken.interface.getFunction("decimals"),
        outputs: [18n],
        kind: "read",
      },
      {
        abi: testCollateralToken.interface.getFunction("symbol"),
        outputs: ["USDT"],
        kind: "read",
      },
    );
    await testBorrowedToken.setup(
      {
        abi: testBorrowedToken.interface.getFunction("decimals"),
        outputs: [18n],
        kind: "read",
      },
      {
        abi: testBorrowedToken.interface.getFunction("symbol"),
        outputs: ["DAI"],
        kind: "read",
      },
    );

    const testPriceFeedFactory =
      await ethers.getContractFactory("TestPriceFeed");
    mockSequencerFeed = await testPriceFeedFactory.deploy(
      // decimals
      18,
      // description
      "Mock Sequencer Feed",
      // version
      1n,
      // roundId
      1n,
      // answer
      2n,
      // startedAt
      BigInt(dayjs().unix()),
      // updatedAt
      BigInt(dayjs().unix()),
      // answeredInRound
      1n,
    );
    await mockSequencerFeed.waitForDeployment();
    mockCollateralFeed = await testPriceFeedFactory.deploy(
      // decimals
      18,
      // description
      "Mock Collateral Feed",
      // version
      1n,
      // roundId
      1n,
      // answer
      1n,
      // startedAt
      BigInt(dayjs().unix()),
      // updatedAt
      BigInt(dayjs().unix()),
      // answeredInRound
      1n,
    );
    await mockCollateralFeed.waitForDeployment();
    mockCollateralFeed2 = await testPriceFeedFactory.deploy(
      // decimals
      18,
      // description
      "Mock Collateral Feed 2",
      // version
      1n,
      // roundId
      1n,
      // answer
      1n,
      // startedAt
      BigInt(dayjs().unix()),
      // updatedAt
      BigInt(dayjs().unix()),
      // answeredInRound
      1n,
    );
    await mockCollateralFeed2.waitForDeployment();
    mockCollateralFeed3 = await deployMock<TestPriceFeed>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    mockCollateralFeed4 = await testPriceFeedFactory.deploy(
      // decimals
      18,
      // description
      "Mock Collateral Feed 4",
      // version
      1n,
      // roundId
      1n,
      // answer
      1n,
      // startedAt
      BigInt(dayjs().unix()),
      // updatedAt
      BigInt(dayjs().unix()),
      // answeredInRound
      1n,
    );
    await mockCollateralFeed4.waitForDeployment();
    mockCollateralFeed5 = await testPriceFeedFactory.deploy(
      // decimals
      18,
      // description
      "Mock Collateral Feed 5",
      // version
      1n,
      // roundId
      1n,
      // answer
      1n,
      // startedAt
      BigInt(dayjs().unix()),
      // updatedAt
      BigInt(dayjs().unix()),
      // answeredInRound
      1n,
    );
    await mockCollateralFeed5.waitForDeployment();
    mockCollateralFeed6 = await deployMock<TestPriceFeed>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );

    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);

    const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
    // await mockSequencerFeed.setup(
    //   {
    //     abi: priceFeedInterface.getFunction("latestRoundData"),
    //     outputs: [
    //       1000000000000n,
    //       1n,
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       1n,
    //     ],
    //     kind: "read",
    //   },
    //   {
    //     abi: priceFeedInterface.getFunction("decimals"),
    //     outputs: [18n],
    //     kind: "read",
    //   },
    // );
    // await mockCollateralFeed.setup(
    //   {
    //     abi: priceFeedInterface.getFunction("latestRoundData"),
    //     outputs: [
    //       1000000000000n,
    //       1n,
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       1n,
    //     ],
    //     kind: "read",
    //   },
    //   {
    //     abi: priceFeedInterface.getFunction("decimals"),
    //     outputs: [18n],
    //     kind: "read",
    //   },
    // );
    // await mockCollateralFeed2.setup(
    //   {
    //     abi: priceFeedInterface.getFunction("latestRoundData"),
    //     outputs: [
    //       1000000000000n,
    //       1n,
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       1n,
    //     ],
    //     kind: "read",
    //   },
    //   {
    //     abi: priceFeedInterface.getFunction("decimals"),
    //     outputs: [18n],
    //     kind: "read",
    //   },
    // );
    await mockCollateralFeed3.setup(
      {
        abi: priceFeedInterface.getFunction("latestRoundData"),
        outputs: [
          1000000000000n,
          1n,
          BigInt(dayjs.unix(block?.timestamp!).unix()),
          BigInt(dayjs.unix(block?.timestamp!).unix()),
          1n,
        ],
        kind: "read",
      },
      {
        abi: priceFeedInterface.getFunction("decimals"),
        outputs: [18n],
        kind: "read",
      },
    );
    // await mockCollateralFeed4.setup(
    //   {
    //     abi: priceFeedInterface.getFunction("latestRoundData"),
    //     outputs: [
    //       1000000000000n,
    //       1n,
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       1n,
    //     ],
    //     kind: "read",
    //   },
    //   {
    //     abi: priceFeedInterface.getFunction("decimals"),
    //     outputs: [18n],
    //     kind: "read",
    //   },
    // );
    // await mockCollateralFeed5.setup(
    //   {
    //     abi: priceFeedInterface.getFunction("latestRoundData"),
    //     outputs: [
    //       1000000000000n,
    //       1n,
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       BigInt(dayjs.unix(block?.timestamp!).unix()),
    //       1n,
    //     ],
    //     kind: "read",
    //   },
    //   {
    //     abi: priceFeedInterface.getFunction("decimals"),
    //     outputs: [18n],
    //     kind: "read",
    //   },
    // );
    await mockCollateralFeed6.setup(
      {
        abi: priceFeedInterface.getFunction("latestRoundData"),
        outputs: [
          1000000000000n,
          0n,
          BigInt(dayjs.unix(block?.timestamp!).unix()),
          BigInt(dayjs.unix(block?.timestamp!).unix()),
          1n,
        ],
        kind: "read",
      },
      {
        abi: priceFeedInterface.getFunction("decimals"),
        outputs: [18n],
        kind: "read",
      },
    );

    const termOracleFactory = await ethers.getContractFactory(
      "TestTermPriceConsumerV3WithSequencer",
    );
    termOracle = (await upgrades.deployProxy(
      termOracleFactory,
      [devopsWallet.address, await mockSequencerFeed.getAddress()],
      {
        kind: "uups",
      },
    )) as unknown as TestTermPriceConsumerV3WithSequencer;

    // getting timestamp

    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termOracle
        .connect(wallet2)
        .removeTokenPriceFeed(await testCollateralToken.getAddress()),
    ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    )
      .to.emit(termOracle, "SubscribePriceFeed")
      .withArgs(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed.getAddress(),
      );

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(
        await testCollateralToken2.getAddress(),
        await mockCollateralFeed2.getAddress(),
        BigInt(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(devopsWallet)
        .removeTokenPriceFeed(await testCollateralToken2.getAddress()),
    )
      .to.emit(termOracle, "UnsubscribePriceFeed")
      .withArgs(await testCollateralToken2.getAddress());
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("TermPriceConsumerV3 Upgrades", async () => {
    it("TermPriceConsumerV3 upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await termOracle.connect(devopsWallet).upgrade(wallet1.address);

      await expect(
        termOracle.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );
    });
  });

  it("Invalid price feed additions revert", async () => {
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testCollateralToken.getAddress(),
          ZeroAddress,
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWith("Primary Price feed cannot be zero address");
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          ZeroAddress,
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWith("Fallback Price feed cannot be zero address");
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed6.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed6.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");
  });

  it("usdValueOfTokens is callable by new bidlocker after reopening", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const timestamp = BigInt(block!.timestamp);
      
      // Ensure we set a reasonable startedAt time that won't cause underflow
      const gracePeriod = 3600n; // 1 hour
      const buffer = 200n;
      const minTimestamp = gracePeriod + buffer + 1n; // Minimum safe timestamp
      
      // Use the larger of the calculated time or a safe minimum
      const startedAtTime = timestamp > minTimestamp 
        ? timestamp - gracePeriod - buffer 
        : 1n; // Use 1 as a safe fallback
      
      // Set timestamps for both sequencer and collateral feeds
      await mockSequencerFeed.setStartedAt(startedAtTime);
      await mockSequencerFeed.setUpdatedAt(timestamp);
      await mockCollateralFeed.setStartedAt(startedAtTime);
      await mockCollateralFeed.setUpdatedAt(timestamp);
      
      expect(
        await termOracle
          .connect(newBidLocker)
          .usdValueOfTokens(
            await testCollateralToken.getAddress(),
            "1000000000000000000",
          ),
      ).to.deep.equal([1n]);
    });
  it("usdValueOfTokens reverts if price feed doesn't exist for token", async () => {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const timestamp = BigInt(block!.timestamp);
    
    // Ensure we set a reasonable startedAt time that won't cause underflow
    const gracePeriod = 3600n; // 1 hour
    const buffer = 200n;
    const minTimestamp = gracePeriod + buffer + 1n; // Minimum safe timestamp
    
    // Use the larger of the calculated time or a safe minimum
    const startedAtTime = timestamp > minTimestamp 
      ? timestamp - gracePeriod - buffer 
      : 1n; // Use 1 as a safe fallback
    
    // Set timestamps for both sequencer and collateral feeds
    await mockSequencerFeed.setStartedAt(startedAtTime);
    await mockSequencerFeed.setUpdatedAt(timestamp);
    await mockCollateralFeed.setStartedAt(startedAtTime);
    await mockCollateralFeed.setUpdatedAt(timestamp);
    await expect(
      termOracle
        .connect(termRepoCollateralManager)
        .usdValueOfTokens(
          await testCollateralToken2.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "NoPriceFeed");
  });
  it("add fallback price feeds and return price expected according to switch case", async function () {
    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed3.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termOracle
        .connect(wallet2)
        .removeFallbackTokenPriceFeed(await testCollateralToken.getAddress()),
    ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed3.getAddress(),
          BigInt(60 * 60 * 12),
        ),
    )
      .to.emit(termOracle, "SubscribeFallbackPriceFeed")
      .withArgs(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed3.getAddress(),
      );

    await termOracle
      .connect(devopsWallet)
      .addNewTokenFallbackPriceFeed(
        await testCollateralToken2.getAddress(),
        await mockCollateralFeed2.getAddress(),
        BigInt(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(devopsWallet)
        .removeFallbackTokenPriceFeed(await testCollateralToken2.getAddress()),
    )
      .to.emit(termOracle, "UnsubscribeFallbackPriceFeed")
      .withArgs(await testCollateralToken2.getAddress());

    await network.provider.request({
      method: "evm_increaseTime",
      params: [60 * 60 * 25],
    });

    await network.provider.request({
      method: "evm_mine",
      params: [],
    });

    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    const timestamp = BigInt(dayjs.unix(block?.timestamp!).unix());
    await mockSequencerFeed.setStartedAt(timestamp - 3601n);
    await mockSequencerFeed.setUpdatedAt(timestamp - 1n);
    await mockCollateralFeed.setStartedAt(timestamp - 3601n);
    await mockCollateralFeed.setUpdatedAt(timestamp - 1n);

    expect(
      await termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.deep.equal([1n]);

    await termOracle
      .connect(devopsWallet)
      .addNewTokenFallbackPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed.getAddress(),
        0,
      );

    expect(
      await termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.deep.equal([1n]);

    await expect(
      termOracle
        .connect(devopsWallet)
        .removeFallbackTokenPriceFeed(await testCollateralToken.getAddress()),
    )
      .to.emit(termOracle, "UnsubscribeFallbackPriceFeed")
      .withArgs(await testCollateralToken.getAddress());

    await mockCollateralFeed.setUpdatedAt(2n);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed4.getAddress(),
        BigInt(60 * 60 * 24),
      );
    await mockCollateralFeed4.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenPriceFeedAndFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed4.getAddress(),
          BigInt(60 * 60 * 24),
          await mockCollateralFeed5.getAddress(),
          BigInt(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(
      termOracle,
      "AccessControlUnauthorizedAccount",
    );

    await termOracle.connect(devopsWallet).addNewTokenFallbackPriceFeed(
      await testCollateralToken.getAddress(),

      await mockCollateralFeed5.getAddress(),
      BigInt(60 * 60 * 24),
    );

    await mockCollateralFeed5.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed.getAddress(),
        BigInt(60 * 60 * 24),
        await mockCollateralFeed3.getAddress(),
        BigInt(12),
      );

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed3.getAddress(),
        BigInt(12),
        await mockCollateralFeed.getAddress(),
        BigInt(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        await testCollateralToken.getAddress(),
        await mockCollateralFeed2.getAddress(),
        BigInt(60 * 60 * 24),
        await mockCollateralFeed.getAddress(),
        BigInt(60 * 60 * 24),
      );

    mockCollateralFeed2.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");
  });
  it("usdValueOfTokens reverts if sequencer is down", async () => {
    await mockSequencerFeed.setAnswer(1);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "SequencerDownError");
  });
  it("usdValueOfTokens reverts if sequencer hasn't been up longer than grace period", async () => {
    const currentTimestamp = (await ethers.provider.getBlock("latest"))!
      .timestamp;

    await mockSequencerFeed.setStartedAt(currentTimestamp - 100);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testCollateralToken.getAddress(),
          "1000000000000000000",
        ),
    ).to.be.revertedWithCustomError(termOracle, "GracePeriodNotOver");
  });
  it("version returns the current contract version", async () => {
    expect(await termOracle.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
