/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import {
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TestTermPriceConsumerV3,
  TestPriceFeed__factory,
  TestPriceFeed,
  AggregatorV3Interface__factory,
} from "../typechain-types";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";
import { ZeroAddress } from "ethers";
import dayjs from "dayjs";

describe("TermPriceConsumerV3", () => {
  let termRepoCollateralManager: SignerWithAddress;
  let newBidLocker: SignerWithAddress;

  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let devopsWallet: SignerWithAddress;

  let testCollateralToken: MockContract<ERC20Upgradeable>;
  let testCollateralToken2: MockContract<ERC20Upgradeable>;
  let testBorrowedToken: MockContract<ERC20Upgradeable>;
  let termOracle: TestTermPriceConsumerV3;
  let mockCollateralFeed: MockContract<TestPriceFeed> & TestPriceFeed;
  let mockCollateralFeed2: MockContract<TestPriceFeed> & TestPriceFeed;
  let mockCollateralFeed3: MockContract<TestPriceFeed> & TestPriceFeed;
  let mockCollateralFeed4: TestPriceFeed;
  let mockCollateralFeed5: TestPriceFeed;
  let mockCollateralFeed6: MockContract<TestPriceFeed> & TestPriceFeed;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    [termRepoCollateralManager, newBidLocker, wallet1, wallet2, devopsWallet] =
      await ethers.getSigners();
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);

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

    await testCollateralToken.setup({
      abi: testCollateralToken.interface.getFunction("decimals"),
      outputs: [18n],
      kind: "read",
    });
    await testCollateralToken2.setup({
      abi: testCollateralToken2.interface.getFunction("decimals"),
      outputs: [18n],
      kind: "read",
    });
    await testBorrowedToken.setup({
      abi: testBorrowedToken.interface.getFunction("decimals"),
      outputs: [18n],
      kind: "read",
    });

    const termOracleFactory = await ethers.getContractFactory(
      "TestTermPriceConsumerV3",
    );
    termOracle = (await upgrades.deployProxy(
      termOracleFactory,
      [devopsWallet.address],
      {
        kind: "uups",
      },
    )) as unknown as TestTermPriceConsumerV3;

    // getting timestamp
    mockCollateralFeed = await deployMock<TestPriceFeed>(
      TestPriceFeed__factory.abi,
      wallet1,
    );
    mockCollateralFeed2 = await deployMock<TestPriceFeed>(
      TestPriceFeed__factory.abi,
      wallet1,
    );
    mockCollateralFeed3 = await deployMock<TestPriceFeed>(
      TestPriceFeed__factory.abi,
      wallet1,
    );
    const priceFeedFactory = await ethers.getContractFactory("TestPriceFeed");
    mockCollateralFeed4 = await priceFeedFactory.deploy(
      // uint8 decimals_,
      // string memory description_,
      // uint256 version_,
      // uint80 roundId_,
      // int256 answer_,
      // uint256 startedAt_,
      // uint256 updatedAt_,
      // uint80 answeredInRound_
      18,
      "Mock Chainlink Price Feed",
      1,
      1,
      1000000000000n,
      BigInt(dayjs.unix(block?.timestamp!).unix()),
      BigInt(dayjs.unix(block?.timestamp!).unix()),
      1,
    );
    await mockCollateralFeed4.waitForDeployment();
    // mockCollateralFeed5 = await deployMock<TestPriceFeed>(
    //   TestPriceFeed__factory.abi,
    //   wallet1,
    // );
    mockCollateralFeed5 = await priceFeedFactory.deploy(
      // uint8 decimals_,
      // string memory description_,
      // uint256 version_,
      // uint80 roundId_,
      // int256 answer_,
      // uint256 startedAt_,
      // uint256 updatedAt_,
      // uint80 answeredInRound_
      18,
      "Mock Chainlink Price Feed",
      1,
      1,
      1000000000000n,
      BigInt(dayjs.unix(block?.timestamp!).unix()),
      BigInt(dayjs.unix(block?.timestamp!).unix()),
      1,
    );
    mockCollateralFeed6 = await deployMock<TestPriceFeed>(
      TestPriceFeed__factory.abi,
      wallet1,
    );

    const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
    await mockCollateralFeed.setup(
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
    await mockCollateralFeed2.setup(
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
    // await mockollateralFeed4.setup(
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
          BigInt(60 * 60 * 120),
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
  it("version returns the current contract version", async () => {
    expect(await termOracle.version()).to.eq(expectedVersion);
  });

  describe("InvalidUpdateTimestamp tests", () => {
    let mockCollateralFeedFuture: MockContract<TestPriceFeed> & TestPriceFeed;
    let mockFallbackFeedFuture: MockContract<TestPriceFeed> & TestPriceFeed;

    beforeEach(async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const currentTimestamp = block?.timestamp!;
      
      // Create mock feeds with timestamps that are too far in the future
      const futureTimestamp = currentTimestamp + 120; // 120 seconds ahead (> 60 second limit)

      mockCollateralFeedFuture = await deployMock<TestPriceFeed>(
        TestPriceFeed__factory.abi,
        wallet1,
      );
      mockFallbackFeedFuture = await deployMock<TestPriceFeed>(
        TestPriceFeed__factory.abi,
        wallet1,
      );

      const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
      
      // Setup primary feed with future timestamp
      await mockCollateralFeedFuture.setup(
        {
          abi: priceFeedInterface.getFunction("latestRoundData"),
          outputs: [
            1000000000000n, // roundId
            1000000000000n, // answer (price)
            BigInt(currentTimestamp), // startedAt
            BigInt(futureTimestamp), // updatedAt (too far in future)
            1000000000000n, // answeredInRound
          ],
          kind: "read",
        },
        {
          abi: priceFeedInterface.getFunction("decimals"),
          outputs: [18n],
          kind: "read",
        },
      );

      // Setup fallback feed with future timestamp
      await mockFallbackFeedFuture.setup(
        {
          abi: priceFeedInterface.getFunction("latestRoundData"),
          outputs: [
            1000000000000n, // roundId
            1000000000000n, // answer (price)
            BigInt(currentTimestamp), // startedAt
            BigInt(futureTimestamp), // updatedAt (too far in future)
            1000000000000n, // answeredInRound
          ],
          kind: "read",
        },
        {
          abi: priceFeedInterface.getFunction("decimals"),
          outputs: [18n],
          kind: "read",
        },
      );
    });

    it("should revert with InvalidUpdateTimestamp when primary feed timestamp is too far in future and no fallback", async () => {
      // Add primary feed with future timestamp and no fallback
      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testBorrowedToken.getAddress(),
          await mockCollateralFeedFuture.getAddress(),
          BigInt(60 * 60 * 24), // 24 hour refresh threshold
        );

      await expect(
        termOracle
          .connect(newBidLocker)
          .usdValueOfTokens(
            await testBorrowedToken.getAddress(),
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(termOracle, "InvalidUpdateTimestamp");
    });

    it("should revert with InvalidUpdateTimestamp when both primary and fallback feed timestamps are too far in future", async () => {
      // Add both primary and fallback feeds with future timestamps
      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeedAndFallbackPriceFeed(
          await testBorrowedToken.getAddress(),
          await mockCollateralFeedFuture.getAddress(),
          BigInt(60 * 60 * 24), // primary refresh threshold
          await mockFallbackFeedFuture.getAddress(),
          BigInt(60 * 60 * 24), // fallback refresh threshold
        );

      await expect(
        termOracle
          .connect(newBidLocker)
          .usdValueOfTokens(
            await testBorrowedToken.getAddress(),
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(termOracle, "InvalidUpdateTimestamp");
    });

    it("should fall back to fallback feed when primary feed timestamp is too far in future but fallback is valid", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const currentTimestamp = block?.timestamp!;
      
      // Create fallback feed with valid timestamp
      const mockFallbackFeedValid = await deployMock<TestPriceFeed>(
        TestPriceFeed__factory.abi,
        wallet1,
      );

      const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
      
      await mockFallbackFeedValid.setup(
        {
          abi: priceFeedInterface.getFunction("latestRoundData"),
          outputs: [
            1000000000000n, // roundId
            2000000000000n, // answer (different price to verify fallback is used)
            BigInt(currentTimestamp), // startedAt
            BigInt(currentTimestamp), // updatedAt (valid timestamp)
            1000000000000n, // answeredInRound
          ],
          kind: "read",
        },
        {
          abi: priceFeedInterface.getFunction("decimals"),
          outputs: [18n],
          kind: "read",
        },
      );

      // Add primary feed with future timestamp and fallback with valid timestamp
      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeedAndFallbackPriceFeed(
          await testBorrowedToken.getAddress(),
          await mockCollateralFeedFuture.getAddress(),
          BigInt(60 * 60 * 24), // primary refresh threshold
          await mockFallbackFeedValid.getAddress(),
          BigInt(60 * 60 * 24), // fallback refresh threshold
        );

      // Should succeed and use fallback feed price (2.0 instead of 1.0)
      const result = await termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testBorrowedToken.getAddress(),
          "1000000000000000000",
        );
      
      expect(result).to.deep.equal([2000000000000n]); // 2.0 from fallback feed (with 18 decimal places)
    });

    it("should use primary feed when timestamp is exactly at the boundary (60 seconds ahead)", async () => {
      // Move time forward first
      await network.provider.request({
        method: "evm_increaseTime",
        params: [120],
      });
      await network.provider.request({
        method: "evm_mine",
        params: [],
      });

      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const currentTimestamp = block?.timestamp!;
      
      // Create feed with timestamp exactly 60 seconds ahead (at the boundary)
      const boundaryTimestamp = currentTimestamp + 60;

      const mockCollateralFeedBoundary = await deployMock<TestPriceFeed>(
        TestPriceFeed__factory.abi,
        wallet1,
      );

      const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
      
      await mockCollateralFeedBoundary.setup(
        {
          abi: priceFeedInterface.getFunction("latestRoundData"),
          outputs: [
            1000000000000n, // roundId
            3000000000000n, // answer (price to verify this feed is used)
            BigInt(currentTimestamp), // startedAt
            BigInt(boundaryTimestamp), // updatedAt (exactly 60 seconds ahead)
            1000000000000n, // answeredInRound
          ],
          kind: "read",
        },
        {
          abi: priceFeedInterface.getFunction("decimals"),
          outputs: [18n],
          kind: "read",
        },
      );

      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testBorrowedToken.getAddress(),
          await mockCollateralFeedBoundary.getAddress(),
          BigInt(60 * 60 * 24), // 24 hour refresh threshold
        );

      // Move forward 60 seconds so the timestamp is now exactly current
      await network.provider.request({
        method: "evm_increaseTime",
        params: [60],
      });
      await network.provider.request({
        method: "evm_mine",
        params: [],
      });

      // Should succeed - the feed timestamp should now be equal to block.timestamp
      const result = await termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(
          await testBorrowedToken.getAddress(),
          "1000000000000000000",
        );
      
      expect(result).to.deep.equal([3000000000000n]); // 3.0 from primary feed (with 18 decimal places)
    });

    it("should revert with InvalidUpdateTimestamp when timestamp is 120 seconds ahead", async () => {
      const blockNumber = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNumber);
      const currentTimestamp = block?.timestamp!;
      
      // Create feed with timestamp significantly ahead (way over the limit)
      const overLimitTimestamp = currentTimestamp + 120;

      const mockCollateralFeedOverLimit = await deployMock<TestPriceFeed>(
        TestPriceFeed__factory.abi,
        wallet1,
      );

      const priceFeedInterface = AggregatorV3Interface__factory.createInterface();
      
      await mockCollateralFeedOverLimit.setup(
        {
          abi: priceFeedInterface.getFunction("latestRoundData"),
          outputs: [
            1000000000000n, // roundId
            1000000000000n, // answer (price)
            BigInt(currentTimestamp), // startedAt
            BigInt(overLimitTimestamp), // updatedAt (120 seconds ahead - way over limit)
            1000000000000n, // answeredInRound
          ],
          kind: "read",
        },
        {
          abi: priceFeedInterface.getFunction("decimals"),
          outputs: [18n],
          kind: "read",
        },
      );

      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          await testBorrowedToken.getAddress(),
          await mockCollateralFeedOverLimit.getAddress(),
          BigInt(60), // SHORT refresh threshold to force staleness check
        );

      await expect(
        termOracle
          .connect(newBidLocker)
          .usdValueOfTokens(
            await testBorrowedToken.getAddress(),
            "1000000000000000000",
          ),
      ).to.be.revertedWithCustomError(termOracle, "InvalidUpdateTimestamp");
    });
  });

  describe("View Functions", () => {
    it("getPriceFeedConfig returns correct configuration for existing price feed", async () => {
      const [priceFeed, refreshRateThreshold] = await termOracle.getPriceFeedConfig(
        await testCollateralToken.getAddress()
      );
      
      expect(priceFeed).to.equal(await mockCollateralFeed.getAddress());
      expect(refreshRateThreshold).to.equal(BigInt(60 * 60 * 24));
    });

    it("getPriceFeedConfig returns zero values for non-existent price feed", async () => {
      const [priceFeed, refreshRateThreshold] = await termOracle.getPriceFeedConfig(
        await testBorrowedToken.getAddress()
      );
      
      expect(priceFeed).to.equal(ZeroAddress);
      expect(refreshRateThreshold).to.equal(0n);
    });

    it("getFallbackPriceFeedConfig returns correct configuration for existing fallback price feed", async () => {
      // First add a fallback price feed
      await termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed3.getAddress(),
          BigInt(60 * 60 * 12)
        );

      const [fallbackPriceFeed, refreshRateThreshold] = await termOracle.getFallbackPriceFeedConfig(
        await testCollateralToken.getAddress()
      );
      
      expect(fallbackPriceFeed).to.equal(await mockCollateralFeed3.getAddress());
      expect(refreshRateThreshold).to.equal(BigInt(60 * 60 * 12));
    });

    it("getFallbackPriceFeedConfig returns zero values for non-existent fallback price feed", async () => {
      const [fallbackPriceFeed, refreshRateThreshold] = await termOracle.getFallbackPriceFeedConfig(
        await testBorrowedToken.getAddress()
      );
      
      expect(fallbackPriceFeed).to.equal(ZeroAddress);
      expect(refreshRateThreshold).to.equal(0n);
    });

    it("view functions work correctly after adding both primary and fallback feeds", async () => {
      const refreshRatePrimary = BigInt(60 * 60 * 8);
      const refreshRateFallback = BigInt(60 * 60 * 4);

      // Add both primary and fallback price feeds for testCollateralToken2
      await termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeedAndFallbackPriceFeed(
          await testCollateralToken2.getAddress(),
          await mockCollateralFeed2.getAddress(),
          refreshRatePrimary,
          await mockCollateralFeed3.getAddress(),
          refreshRateFallback
        );

      // Check primary price feed config
      const [primaryFeed, primaryThreshold] = await termOracle.getPriceFeedConfig(
        await testCollateralToken2.getAddress()
      );
      expect(primaryFeed).to.equal(await mockCollateralFeed2.getAddress());
      expect(primaryThreshold).to.equal(refreshRatePrimary);

      // Check fallback price feed config  
      const [fallbackFeed, fallbackThreshold] = await termOracle.getFallbackPriceFeedConfig(
        await testCollateralToken2.getAddress()
      );
      expect(fallbackFeed).to.equal(await mockCollateralFeed3.getAddress());
      expect(fallbackThreshold).to.equal(refreshRateFallback);
    });

    it("view functions reflect changes after removing price feeds", async () => {
      // First add a fallback feed
      await termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          await testCollateralToken.getAddress(),
          await mockCollateralFeed3.getAddress(),
          BigInt(60 * 60 * 6)
        );

      // Verify it was added
      const [fallbackFeed, fallbackThreshold] = await termOracle.getFallbackPriceFeedConfig(
        await testCollateralToken.getAddress()
      );
      expect(fallbackFeed).to.equal(await mockCollateralFeed3.getAddress());
      expect(fallbackThreshold).to.equal(BigInt(60 * 60 * 6));

      // Remove the fallback feed
      await termOracle
        .connect(devopsWallet)
        .removeFallbackTokenPriceFeed(await testCollateralToken.getAddress());

      // Verify it was removed
      const [removedFallbackFeed, removedFallbackThreshold] = await termOracle.getFallbackPriceFeedConfig(
        await testCollateralToken.getAddress()
      );
      expect(removedFallbackFeed).to.equal(ZeroAddress);
      expect(removedFallbackThreshold).to.equal(0n);

      // Primary feed should still be there
      const [primaryFeed, primaryThreshold] = await termOracle.getPriceFeedConfig(
        await testCollateralToken.getAddress()
      );
      expect(primaryFeed).to.equal(await mockCollateralFeed.getAddress());
      expect(primaryThreshold).to.equal(BigInt(60 * 60 * 24));
    });
  });
});
/* eslint-enable camelcase */
