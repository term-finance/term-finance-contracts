import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import dayjs from "dayjs";
import { ethers, network, upgrades } from "hardhat";
import {
  TermController,
  TermController__factory,
  TermEventEmitter,
  TermRepoCollateralManager,
  TermRepoCollateralManager__factory,
  TermRepoServicer,
  TermRepoServicer__factory,
  TestTermRepoToken,
} from "../typechain-types";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";
import { solidityPackedKeccak256 } from "ethers";

describe("TermRepoToken Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let contractAddress: SignerWithAddress;
  let collateralToken: SignerWithAddress;
  let termDiamond: SignerWithAddress;
  let termEventEmitter: TermEventEmitter;
  let mockTermController: MockContract<TermController>;
  let mockTermRepoServicer: MockContract<TermRepoServicer>;
  let mockTermRepoCollateralManager: MockContract<TermRepoCollateralManager>;

  let termRepoToken: TestTermRepoToken;
  let termIdHashed: string;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    [
      wallet1,
      contractAddress,
      wallet2,
      termInitializer,
      devopsMultisig,
      adminWallet,
      collateralToken,
      termDiamond
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();
    const TermRepoToken = await ethers.getContractFactory("TestTermRepoToken");

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet2.address, termInitializer.address, adminWallet.address, termDiamond.address],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    mockTermController = await deployMock(TermController__factory.abi, wallet1);
    const mockTermControllerInterface = TermController__factory.createInterface();
    await mockTermController.setup(
      {
        abi: mockTermControllerInterface.getFunction("termContractsPaused"),
        inputs: [],
        outputs: [false],
        kind: "read",
      },
    );

    const mockTermRepoCollateralManager = await deployMock(
      TermRepoCollateralManager__factory.abi,
      wallet1,
    );

    mockTermRepoServicer = await deployMock(
      TermRepoServicer__factory.abi,
      wallet1,
    );
    const mockTermRepoCollateralManagerInterface =
      TermRepoCollateralManager__factory.createInterface();
    const mockTermRepoServicerInterface = TermRepoServicer__factory.createInterface();
    await mockTermRepoCollateralManager.setup(
      {
        abi: mockTermRepoCollateralManagerInterface.getFunction(
          "numOfAcceptedCollateralTokens",
        ),
        inputs: [],
        outputs: [1n],
        kind: "read",
      },
      {
        abi: mockTermRepoCollateralManagerInterface.getFunction(
          "collateralTokens",
        ),
        inputs: [0],
        outputs: [collateralToken.address],
        kind: "read",
      },
      {
        abi: mockTermRepoCollateralManagerInterface.getFunction(
          "maintenanceCollateralRatios",
        ),
        inputs: [collateralToken.address],
        outputs: [150000000000000000000n],
        kind: "read",
      },
    );

    await mockTermRepoServicer.setup(
      {
        abi: mockTermRepoServicerInterface.getFunction("termController"),
        inputs: [],
        outputs: [
          await mockTermController.getAddress(),
        ],
        kind: "read",
      },
    );

    const termIdString = "term-id-1";

    termRepoToken = (await upgrades.deployProxy(
      TermRepoToken,
      [
        termIdString,
        "TermRepoToken_MMDDYY",
        "TT",
        6,
        "1000000000000000000",
        "1000000000000000000",
        termInitializer.address,
        {
          redemptionTimestamp: dayjs().unix(),
          purchaseToken: "0x0000000000000000000000000000000000000002",
          termRepoServicer: await mockTermRepoServicer.getAddress(),
          termRepoCollateralManager:
            await mockTermRepoCollateralManager.getAddress(),
        },
      ],
      {
        kind: "uups",
      },
    )) as unknown as TestTermRepoToken;

    await termRepoToken.waitForDeployment();
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoToken.getAddress());
    await expect(
      termRepoToken
        .connect(wallet2)
        .pairTermContracts(
          contractAddress.address,
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

    await termRepoToken
      .connect(termInitializer)
      .pairTermContracts(
        contractAddress.address,
        await termEventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );
    await expect(
      termRepoToken
        .connect(termInitializer)
        .pairTermContracts(
          contractAddress.address,
          await termEventEmitter.getAddress(),
          devopsMultisig.address,
          adminWallet.address,
        ),
    ).to.be.revertedWithCustomError(termRepoToken, "AlreadyTermContractPaired");
    termIdHashed = solidityPackedKeccak256(["string"], [termIdString]);

    const termRepoTokenInitializedFilter =
      termEventEmitter.filters.TermRepoTokenInitialized(
        undefined,
        undefined,
        undefined,
      );

    const termRepoTokenIntializedEvents = await termEventEmitter.queryFilter(
      termRepoTokenInitializedFilter,
    );

    expect(termRepoTokenIntializedEvents.length).to.equal(1);
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("TermRepoToken Upgrades", async () => {
    it("TermRepoToken upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await expect(
        termRepoToken.connect(devopsMultisig).upgrade(wallet1.address),
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(await termRepoToken.getAddress(), wallet1.address);

      await expect(
        termRepoToken.connect(wallet2).upgrade(wallet1.address),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );
    });
  });

  describe("Getter functions", async () => {
    it("Decimals function", async () => {
      expect(await termRepoToken.decimals()).to.eq(6);
    });
    it("Collateral Data function", async () => {
      const repoTokenCollateralData =
        await termRepoToken.getCollateralRequirements();
      expect(repoTokenCollateralData).to.deep.equal([
        [collateralToken.address],
        [BigInt("150000000000000000000")],
      ]);
    });
  });

  describe("Minting tests", async () => {
    it("Mint Call by Address Not granted Minter Role", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termRepoToken
          .connect(wallet1)
          .mintRedemptionValue(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
      "AccessControlUnauthorizedAccount",
      );

      await expect(
        termRepoToken.connect(wallet1).mintTokens(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("Mint Calls by Minter Role succeeds", async () => {
      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(10000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(10000000);

      await termRepoToken
        .connect(contractAddress)
        .mintTokens(wallet1.address, 10000000);

      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(20000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(20000000);
    });
    it("Mint Calls revert when minting is paused and succeed when unpaused.", async () => {
      // pausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).pauseMinting(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).pauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintRedemptionValue(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused",
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintTokens(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseMinting(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).unpauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingUnpaused")
        .withArgs(termIdHashed);

      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(10000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(10000000);

      await termRepoToken
        .connect(contractAddress)
        .mintTokens(wallet1.address, 10000000);

      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(20000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(20000000);
    });
  });
  describe("Minting tests", async () => {
    it("Resetting max direct mint supply", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termRepoToken
          .connect(wallet2)
          .resetMintExposureCap("2000000000000000000"),
      ).to.be.revertedWithCustomError(
        termRepoToken,
      "AccessControlUnauthorizedAccount",
      );

      await termRepoToken
        .connect(adminWallet)
        .resetMintExposureCap("2000000000000000000");

      expect(await termRepoToken.mintExposureCap()).to.be.eq(
        "2000000000000000000",
      );
    });
    it("Decrementing max direct mint supply", async () => {
      await termRepoToken
        .connect(contractAddress)
        .decrementMintExposureCap("500000000000000000");

      expect(await termRepoToken.mintExposureCap()).to.eq("500000000000000000");
    });
    it("Decrementing beyond direct mint supply reverts", async () => {
      await expect(
        termRepoToken
          .connect(contractAddress)
          .decrementMintExposureCap("2000000000000000000"),
      ).to.revertedWithCustomError(termRepoToken, `MintExposureCapExceeded`);
    });
    it("Mint Call by Address Not granted Minter Role", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termRepoToken
          .connect(wallet1)
          .mintRedemptionValue(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
      "AccessControlUnauthorizedAccount",
      );

      await expect(
        termRepoToken.connect(wallet1).mintTokens(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("Mint Calls by Minter Role succeeds", async () => {
      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(10000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(10000000);

      await termRepoToken
        .connect(contractAddress)
        .mintTokens(wallet1.address, 10000000);

      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(20000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(20000000);
    });
    it("Mint Calls revert when minting is paused and succeed when unpaused.", async () => {
      // pausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).pauseMinting(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).pauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintRedemptionValue(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused",
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintTokens(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseMinting(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).unpauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingUnpaused")
        .withArgs(termIdHashed);

      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(10000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(10000000);

      await termRepoToken
        .connect(contractAddress)
        .mintTokens(wallet1.address, 10000000);

      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(20000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(20000000);
    });
  });
  describe("Burning tests", async () => {
    it("Burn Call by Address Not granted Burner Role", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      await expect(
        termRepoToken.connect(wallet1).burn(wallet1.address, 10),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );
    });
    it("Burn Call by Burner Role succeeds", async () => {
      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      await termRepoToken
        .connect(contractAddress)
        .burn(wallet1.address, 9000000);
      expect(await termRepoToken.mintExposureCap()).to.eq(
        "1000000000009000000",
      );

      expect(await termRepoToken.balanceOf(wallet1.address)).to.equal(1000000);
      expect(await termRepoToken.totalRedemptionValue()).to.equal(1000000);
    });
    it("Burn Calls revert when burning is paused and succeed when unpaused.", async () => {
      await termRepoToken
        .connect(contractAddress)
        .mintRedemptionValue(wallet1.address, 10000000);
      // pausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).pauseBurning(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).pauseBurning())
        .to.emit(termEventEmitter, "TermRepoTokenBurningPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken.connect(contractAddress).burn(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenBurningPaused",
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .burnAndReturnValue(wallet1.address, 10000000),
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenBurningPaused",
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseBurning(),
      ).to.be.revertedWithCustomError(
      termRepoToken,
      "AccessControlUnauthorizedAccount",
    );

      await expect(termRepoToken.connect(adminWallet).unpauseBurning())
        .to.emit(termEventEmitter, "TermRepoTokenBurningUnpaused")
        .withArgs(termIdHashed);

      await termRepoToken.connect(contractAddress).burn(wallet1.address, 100);

      // TODO: Figure out how to test return value of a write function.
      await termRepoToken
        .connect(contractAddress)
        .burnAndReturnValue(wallet1.address, 100);
    });
  });
  it("version returns the current contract version", async () => {
    expect(await termRepoToken.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
