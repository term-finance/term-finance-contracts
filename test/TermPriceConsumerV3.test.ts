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
  TestTermPriceConsumerV3,
  TestPriceFeed__factory,
} from "../typechain-types";

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
  let mockCollateralFeed: MockContract<AggregatorV3Interface>;
  let mockCollateralFeed2: MockContract<AggregatorV3Interface>;

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
      "TestTermPriceConsumerV3",
    );
    termOracle = (await upgrades.deployProxy(
      termOracleFactory,
      [devopsWallet.address],
      {
        kind: "uups",
      },
    )) as TestTermPriceConsumerV3;

    const mockCollateralFeedFactory =
      await smock.mock<TestPriceFeed__factory>("TestPriceFeed");
    mockCollateralFeed = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      1e9,
      1,
      1,
      1,
    );
    mockCollateralFeed2 = await mockCollateralFeedFactory.deploy(
      9,
      "",
      1,
      1,
      2 * 1e9,
      1,
      1,
      1,
    );

    await expect(
      termOracle
        .connect(wallet2)
        .addNewTokenPriceFeed(
          testCollateralToken.address,
          mockCollateralFeed.address,
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
        ),
    )
      .to.emit(termOracle, "SubscribePriceFeed")
      .withArgs(testCollateralToken.address, mockCollateralFeed.address);

    await termOracle
      .connect(devopsWallet)
      .addNewTokenPriceFeed(
        testCollateralToken2.address,
        mockCollateralFeed2.address,
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
    ).to.be.reverted;
  });
  it("version returns the current contract version", async () => {
    expect(await termOracle.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
