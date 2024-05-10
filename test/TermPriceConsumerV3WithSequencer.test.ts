/* eslint-disable camelcase */
import { MockContract, smock } from "@defi-wonderland/smock";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network, upgrades } from "hardhat";

import {
  AggregatorV3Interface,
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TestTermPriceConsumerV3WithSequencer,
  TestPriceFeed__factory,
} from "../typechain-types";

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
  let mockCollateralFeed: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed2: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed3: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed4: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed5: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed6: MockContract<AggregatorV3Interface>;

  let mockSequencerFeed: MockContract<AggregatorV3Interface>;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    [termRepoCollateralManager, newBidLocker, wallet1, wallet2, devopsWallet] =
      await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const testTokenFactory =
      await smock.mock<ERC20Upgradeable__factory>("ERC20Upgradeable");
    testCollateralToken = await testTokenFactory.deploy();
    await testCollateralToken.deployed();
    testCollateralToken2 = await testTokenFactory.deploy();
    await testCollateralToken2.deployed();
    testBorrowedToken = await testTokenFactory.deploy();
    await testBorrowedToken.deployed();

    const termOracleFactory = await ethers.getContractFactory(
      "TestTermPriceConsumerV3WithSequencer",
    );

    const mockSequencerFeedFactory =
      await smock.mock<TestPriceFeed__factory>("TestPriceFeed");
    mockSequencerFeed = await mockSequencerFeedFactory.deploy(
      9,
      "",
      1,
      1,
      0,
      1,
      1,
      1,
    );
    termOracle = (await upgrades.deployProxy(
      termOracleFactory,
      [devopsWallet.address, mockSequencerFeed.address],
      {
        kind: "uups",
      },
    )) as TestTermPriceConsumerV3WithSequencer;

    // getting timestamp

    const timestampBefore = (await ethers.provider.getBlock("latest"))
      .timestamp;

    const mockCollateralFeedFactory =
      await smock.mock<TestPriceFeed__factory>("TestPriceFeed");
    mockCollateralFeed = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      1e9,
      1,
      timestampBefore,
      1,
    );
    mockCollateralFeed2 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      2 * 1e9,
      1,
      timestampBefore,
      1,
    );
    mockCollateralFeed3 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      2 * 1e9,
      1,
      timestampBefore + 60 * 60 * 23,
      1,
    );
    mockCollateralFeed4 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      2 * 1e9,
      1,
      timestampBefore + 60 * 60 * 22,
      1,
    );
    mockCollateralFeed5 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      2 * 1e9,
      1,
      timestampBefore + 60 * 60 * 22,
      1,
    );
    mockCollateralFeed6 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      0,
      1,
      timestampBefore + 60 * 60 * 22,
      1,
    );

    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed.address,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );

    await expect(
      termOracle
        .connect(wallet2)
        .removeTokenPriceFeed(testCollateralToken.address),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed.address,
          BigNumber.from(60 * 60 * 24),
        ),
    )
      .to.emit(termOracle, "SubscribePriceFeed")
      .withArgs(testCollateralToken.address, mockCollateralFeed.address);

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(
        testCollateralToken2.address,
        mockCollateralFeed2.address,
        BigNumber.from(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(devopsWallet)
        .removeTokenPriceFeed(testCollateralToken2.address),
    )
      .to.emit(termOracle, "UnsubscribePriceFeed")
      .withArgs(testCollateralToken2.address);
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
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
  });

  it("Invalid price feed additions revert", async () => {
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          testCollateralToken.address,
          ethers.constants.AddressZero,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWith("Primary Price feed cannot be zero address");
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          testCollateralToken.address,
          ethers.constants.AddressZero,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWith("Fallback Price feed cannot be zero address");
    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed6.address,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed6.address,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");
  });

  it("usdValueOfTokens is callable by new bidlocker after reopening", async () => {
    expect(
      JSON.parse(
        JSON.stringify(
          await termOracle
            .connect(newBidLocker)
            .usdValueOfTokens(
              testCollateralToken.address,
              "1000000000000000000",
            ),
        ),
      ),
    ).to.deep.equal([BigNumber.from("1000000000000000000").toJSON()]);
  });

  it("usdValueOfTokens reverts if price feed doesn't exist for token", async () => {
    await expect(
      termOracle
        .connect(termRepoCollateralManager)
        .usdValueOfTokens(testCollateralToken2.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "NoPriceFeed");
  });
  it("add fallback price feeds and return price expected according to switch case", async function () {
    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenFallbackPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed3.address,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );

    await expect(
      termOracle
        .connect(wallet2)
        .removeFallbackTokenPriceFeed(testCollateralToken.address),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );

    await expect(
      termOracle
        .connect(devopsWallet)
        .addNewTokenFallbackPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed3.address,
          BigNumber.from(60 * 60 * 12),
        ),
    )
      .to.emit(termOracle, "SubscribeFallbackPriceFeed")
      .withArgs(testCollateralToken.address, mockCollateralFeed3.address);

    await termOracle
      .connect(devopsWallet)
      .addNewTokenFallbackPriceFeed(
        testCollateralToken2.address,
        mockCollateralFeed2.address,
        BigNumber.from(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(devopsWallet)
        .removeFallbackTokenPriceFeed(testCollateralToken2.address),
    )
      .to.emit(termOracle, "UnsubscribeFallbackPriceFeed")
      .withArgs(testCollateralToken2.address);

    await network.provider.request({
      method: "evm_increaseTime",
      params: [60 * 60 * 25],
    });

    await network.provider.request({
      method: "evm_mine",
      params: [],
    });

    expect(
      JSON.parse(
        JSON.stringify(
          await termOracle
            .connect(newBidLocker)
            .usdValueOfTokens(
              testCollateralToken.address,
              "1000000000000000000",
            ),
        ),
      ),
    ).to.deep.equal([BigNumber.from("2000000000000000000").toJSON()]);

    await termOracle
      .connect(devopsWallet)
      .addNewTokenFallbackPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed.address,
        0,
      );

    expect(
      JSON.parse(
        JSON.stringify(
          await termOracle
            .connect(newBidLocker)
            .usdValueOfTokens(
              testCollateralToken.address,
              "1000000000000000000",
            ),
        ),
      ),
    ).to.deep.equal([BigNumber.from("1000000000000000000").toJSON()]);


    await expect(
      termOracle
        .connect(devopsWallet)
        .removeFallbackTokenPriceFeed(testCollateralToken.address),
    )
      .to.emit(termOracle, "UnsubscribeFallbackPriceFeed")
      .withArgs(testCollateralToken.address);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed4.address,
        BigNumber.from(60 * 60 * 24),
      );
    await mockCollateralFeed4.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenPriceFeedAndFallbackPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed4.address,
          BigNumber.from(60 * 60 * 24),
          mockCollateralFeed5.address,
          BigNumber.from(60 * 60 * 24),
        ),
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
    );

    await termOracle.connect(devopsWallet).addNewTokenFallbackPriceFeed(
      testCollateralToken.address,

      mockCollateralFeed5.address,
      BigNumber.from(60 * 60 * 24),
    );

    await mockCollateralFeed5.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "InvalidPrice");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed.address,
        BigNumber.from(60 * 60 * 24),
        mockCollateralFeed3.address,
        BigNumber.from(12),
      );

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed3.address,
        BigNumber.from(12),
        mockCollateralFeed.address,
        BigNumber.from(60 * 60 * 24),
      );

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeedAndFallbackPriceFeed(
        testCollateralToken.address,
        mockCollateralFeed2.address,
        BigNumber.from(60 * 60 * 24),
        mockCollateralFeed.address,
        BigNumber.from(60 * 60 * 24),
      );

    mockCollateralFeed2.setAnswerToZero();

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "PricesStale");
  });
  it("usdValueOfTokens reverts if sequencer is down", async () => {
    await mockSequencerFeed.setAnswer(1);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "SequencerDownError");
  });
  it("usdValueOfTokens reverts if sequencer hasn't been up longer than grace period", async () => {
    const currentTimestamp = (await ethers.provider.getBlock("latest"))
      .timestamp;

    await mockSequencerFeed.setStartedAt(currentTimestamp - 100);

    await expect(
      termOracle
        .connect(newBidLocker)
        .usdValueOfTokens(testCollateralToken.address, "1000000000000000000"),
    ).to.be.revertedWithCustomError(termOracle, "GracePeriodNotOver");
  });
  it("version returns the current contract version", async () => {
    expect(await termOracle.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
