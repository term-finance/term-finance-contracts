import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import dayjs from "dayjs";
import { ethers, network, upgrades } from "hardhat";
import { TermEventEmitter, TestTermRepoToken } from "../typechain-types";

describe("TermRepoToken Tests", () => {
  let wallet1: SignerWithAddress;
  let wallet2: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let contractAddress: SignerWithAddress;
  let termEventEmitter: TermEventEmitter;

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
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();
    const TermRepoToken = await ethers.getContractFactory("TestTermRepoToken");

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet2.address, termInitializer.address],
      { kind: "uups" }
    )) as TermEventEmitter;

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
          purchaseToken: "0x0000000000000000000000000000000000000000",
          collateralTokens: ["0x0000000000000000000000000000000000000000"],
          maintenanceCollateralRatios: ["1000000000000000000"],
        },
      ],
      {
        kind: "uups",
      }
    )) as TestTermRepoToken;

    await termRepoToken.deployed();
    await termEventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoToken.address);
    await expect(
      termRepoToken
        .connect(wallet2)
        .pairTermContracts(
          contractAddress.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address
        )
    ).to.be.revertedWith(
      `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x30d41a597cac127d8249d31298b50e481ee82c3f4a49ff93c76a22735aa9f3ad`
    );

    await termRepoToken
      .connect(termInitializer)
      .pairTermContracts(
        contractAddress.address,
        termEventEmitter.address,
        devopsMultisig.address,
        adminWallet.address
      );
    await expect(
      termRepoToken
        .connect(termInitializer)
        .pairTermContracts(
          contractAddress.address,
          termEventEmitter.address,
          devopsMultisig.address,
          adminWallet.address
        )
    ).to.be.revertedWithCustomError(termRepoToken, "AlreadyTermContractPaired");
    termIdHashed = ethers.utils.solidityKeccak256(["string"], [termIdString]);

    const termRepoTokenInitializedFilter =
      termEventEmitter.filters.TermRepoTokenInitialized(null, null, null);

    const termRepoTokenIntializedEvents = await termEventEmitter.queryFilter(
      termRepoTokenInitializedFilter
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
        termRepoToken.connect(devopsMultisig).upgrade(wallet1.address)
      )
        .to.emit(termEventEmitter, "TermContractUpgraded")
        .withArgs(termRepoToken.address, wallet1.address);

      await expect(
        termRepoToken.connect(wallet2).upgrade(wallet1.address)
      ).to.be.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );
    });
  });

  describe("Getter functions", async () => {
    it("Decimals function", async () => {
      expect(await termRepoToken.decimals()).to.eq(6);
    });
  });

  describe("Minting tests", async () => {
    it("Mint Call by Address Not granted Minter Role", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termRepoToken
          .connect(wallet1)
          .mintRedemptionValue(wallet1.address, 10000000)
      ).to.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`
      );

      await expect(
        termRepoToken.connect(wallet1).mintTokens(wallet1.address, 10000000)
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`
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
        termRepoToken.connect(contractAddress).pauseMinting()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).pauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintRedemptionValue(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused"
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintTokens(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused"
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseMinting()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).unpauseMinting())
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
          .resetMintExposureCap("2000000000000000000")
      ).to.revertedWith(
        `AccessControl: account ${wallet2.address.toLowerCase()} is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775`
      );

      await termRepoToken
        .connect(adminWallet)
        .resetMintExposureCap("2000000000000000000");

      expect(await termRepoToken.mintExposureCap()).to.be.eq(
        "2000000000000000000"
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
          .decrementMintExposureCap("2000000000000000000")
      ).to.revertedWithCustomError(termRepoToken, `MintExposureCapExceeded`);
    });
    it("Mint Call by Address Not granted Minter Role", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termRepoToken
          .connect(wallet1)
          .mintRedemptionValue(wallet1.address, 10000000)
      ).to.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`
      );

      await expect(
        termRepoToken.connect(wallet1).mintTokens(wallet1.address, 10000000)
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6`
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
        termRepoToken.connect(contractAddress).pauseMinting()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).pauseMinting())
        .to.emit(termEventEmitter, "TermRepoTokenMintingPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintRedemptionValue(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused"
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .mintTokens(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenMintingPaused"
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseMinting()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).unpauseMinting())
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
        termRepoToken.connect(wallet1).burn(wallet1.address, 10)
      ).to.be.revertedWith(
        `AccessControl: account ${wallet1.address.toLowerCase()} is missing role 0x3c11d16cbaffd01df69ce1c404f6340ee057498f5f00246190ea54220576a848`
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
        "1000000000009000000"
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
        termRepoToken.connect(contractAddress).pauseBurning()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).pauseBurning())
        .to.emit(termEventEmitter, "TermRepoTokenBurningPaused")
        .withArgs(termIdHashed);

      await expect(
        termRepoToken.connect(contractAddress).burn(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenBurningPaused"
      );

      await expect(
        termRepoToken
          .connect(contractAddress)
          .burnAndReturnValue(wallet1.address, 10000000)
      ).to.be.revertedWithCustomError(
        termRepoToken,
        "TermRepoTokenBurningPaused"
      );

      // unpausing reverts when not called by the admin
      await expect(
        termRepoToken.connect(contractAddress).unpauseBurning()
      ).to.be.revertedWith(
        `AccessControl: account ${contractAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`
      );

      await expect(termRepoToken.connect(devopsMultisig).unpauseBurning())
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
