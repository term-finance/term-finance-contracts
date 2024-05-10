import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber, Contract, constants } from "ethers";
import { solidityKeccak256 } from "ethers/lib/utils";
import { ethers, network, upgrades } from "hardhat";

describe("TermController Tests", () => {
  let ownerAddress: SignerWithAddress;
  let originalTreasuryAddress: SignerWithAddress;
  let originalProtocolReservesAddress: SignerWithAddress;
  let externalAddress: SignerWithAddress;
  let newTreasuryAddress: SignerWithAddress;
  let newProtocolResrvesAddress: SignerWithAddress;
  let potentialTermAddress: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let controllerAdminWallet: SignerWithAddress;
  let devopsWallet: SignerWithAddress;
  let initializer: SignerWithAddress;
  let auction: SignerWithAddress;
  let auction2: SignerWithAddress;

  let termController: Contract;

  let snapshotId: any;
  let expectedVersion: string;

  before(async () => {
    upgrades.silenceWarnings();

    [
      ownerAddress,
      originalTreasuryAddress,
      originalProtocolReservesAddress,
      externalAddress,
      newProtocolResrvesAddress,
      newTreasuryAddress,
      potentialTermAddress,
      adminWallet,
      controllerAdminWallet,
      devopsWallet,
      initializer,
      auction,
      auction2,
    ] = await ethers.getSigners();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const TermController =
      await ethers.getContractFactory("TestTermController");

    termController = await upgrades.deployProxy(
      TermController,
      [
        originalTreasuryAddress.address,
        originalProtocolReservesAddress.address,
        controllerAdminWallet.address,
        devopsWallet.address,
        adminWallet.address,
      ],
      {
        kind: "uups",
      },
    );

    await expect(termController.pairInitializer(potentialTermAddress.address))
      .to.be.reverted;

    await termController
      .connect(adminWallet)
      .pairInitializer(initializer.address);
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("TermController Upgrades", async () => {
    it("TermController upgrade succeeds with admin and reverted if called by somebody else", async () => {
      await termController.connect(devopsWallet).upgrade(ownerAddress.address);

      await expect(
        termController
          .connect(externalAddress)
          .upgrade(externalAddress.address),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
  });

  describe("Improper initializations", async () => {
    it("Revert if controller admin is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            originalTreasuryAddress.address,
            originalProtocolReservesAddress.address,
            ethers.constants.AddressZero,
            devopsWallet.address,
            adminWallet.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("controller admin is zero address");
    });
    it("Revert if devops wallet is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            originalTreasuryAddress.address,
            originalProtocolReservesAddress.address,
            controllerAdminWallet.address,
            ethers.constants.AddressZero,
            adminWallet.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("devops wallet is zero address");
    });
    it("Revert if admin wallet is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            originalTreasuryAddress.address,
            originalProtocolReservesAddress.address,
            controllerAdminWallet.address,
            devopsWallet.address,
            ethers.constants.AddressZero,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("admin wallet is zero address");
    });
    it("Revert if treasury wallet is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            ethers.constants.AddressZero,
            originalProtocolReservesAddress.address,
            controllerAdminWallet.address,
            devopsWallet.address,
            adminWallet.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("treasury is zero address");
    });
    it("Revert if reserve wallet is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            originalTreasuryAddress.address,
            ethers.constants.AddressZero,
            controllerAdminWallet.address,
            devopsWallet.address,
            adminWallet.address,
          ],
          {
            kind: "uups",
          },
        ),
      ).to.be.revertedWith("reserve is zero address");
    });
  });

  describe("Admin Methods secured", async () => {
    it("External Addresses cannot update treasury address or protocol reserves", async () => {
      await expect(
        termController
          .connect(externalAddress)
          .updateTreasuryAddress(externalAddress.address),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );

      await expect(
        termController
          .connect(externalAddress)
          .updateProtocolReserveAddress(externalAddress.address),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
    it("External Addresses cannot add or remove a Term Finance Address", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termController
          .connect(externalAddress)
          .markTermDeployed(externalAddress.address),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x9027349758afcb3649adbc1f090fcd4eb9187cfbbd22483c7d103367d7b50173`,
      );

      await expect(
        termController
          .connect(externalAddress)
          .unmarkTermDeployed(externalAddress.address),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x9027349758afcb3649adbc1f090fcd4eb9187cfbbd22483c7d103367d7b50173`,
      );
    });
    it("Secured update of controller admin", async () => {
      await expect(
        termController
          .connect(externalAddress)
          .updateControllerAdminWallet(
            controllerAdminWallet.address,
            externalAddress.address,
          ),
      ).to.be.revertedWith(
        `AccessControl: account ${externalAddress.address.toLowerCase()} is missing role 0x793a6c9b7e0a9549c74edc2f9ae0dc50903dfaa9a56fb0116b27a8c71de3e2c6`,
      );
    });
  });
  describe("term controller updates by admin and reads by external wallet", async () => {
    it("Treasury external reads and succcssful owner updates", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      expect(
        await termController.connect(externalAddress).getTreasuryAddress(),
      ).to.equal(originalTreasuryAddress.address);
      await expect(
        termController
          .connect(devopsWallet)
          .updateTreasuryAddress(newTreasuryAddress.address),
      )
        .to.emit(termController, "TreasuryAddressUpdated")
        .withArgs(originalTreasuryAddress.address, newTreasuryAddress.address);

      expect(
        await termController.connect(externalAddress).getTreasuryAddress(),
      ).to.equal(newTreasuryAddress.address);
    });

    it("Treasury update reverts when updated with current treasury address", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")

      await expect(
        termController
          .connect(devopsWallet)
          .updateTreasuryAddress(originalTreasuryAddress.address),
      ).to.be.revertedWith("No change in treasury address");
    });
    it("Protocol Reserves external reads and succcssful owner updates", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      expect(
        await termController
          .connect(externalAddress)
          .getProtocolReserveAddress(),
      ).to.equal(originalProtocolReservesAddress.address);
      await expect(
        termController
          .connect(devopsWallet)
          .updateProtocolReserveAddress(newProtocolResrvesAddress.address),
      )
        .to.emit(termController, "ProtocolReserveAddressUpdated")
        .withArgs(
          originalProtocolReservesAddress.address,
          newProtocolResrvesAddress.address,
        );

      expect(
        await termController
          .connect(externalAddress)
          .getProtocolReserveAddress(),
      ).to.equal(newProtocolResrvesAddress.address);
    });
    it("Controller Admin wallet update", async () => {
      await expect(
        termController
          .connect(devopsWallet)
          .updateControllerAdminWallet(
            constants.AddressZero,
            newProtocolResrvesAddress.address,
          ),
      ).to.be.revertedWith(
        "Old Controller Admin Wallet cannot be zero address",
      );

      await expect(
        termController
          .connect(devopsWallet)
          .updateControllerAdminWallet(
            controllerAdminWallet.address,
            constants.AddressZero,
          ),
      ).to.be.revertedWith(
        "New Controller Admin Wallet cannot be zero address",
      );

      await termController
        .connect(devopsWallet)
        .updateControllerAdminWallet(
          controllerAdminWallet.address,
          newProtocolResrvesAddress.address,
        );

      await termController
        .connect(newProtocolResrvesAddress)
        .markTermDeployed(potentialTermAddress.address);
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(true);
    });
    it("Protocol reserves update reverts when updated with current reserve address", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")

      await expect(
        termController
          .connect(devopsWallet)
          .updateProtocolReserveAddress(
            originalProtocolReservesAddress.address,
          ),
      ).to.be.revertedWith("No change in protocol reserve address");
    });
    it("External Term Contract check and successful owner update and remove  ", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(false);
      await termController
        .connect(controllerAdminWallet)
        .markTermDeployed(potentialTermAddress.address);
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(true);
      await termController
        .connect(controllerAdminWallet)
        .unmarkTermDeployed(potentialTermAddress.address);
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(false);
    });
    it("Adding term contract that has already been added gets reverted", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(false);
      await termController
        .connect(controllerAdminWallet)
        .markTermDeployed(potentialTermAddress.address);
      await expect(
        termController
          .connect(controllerAdminWallet)
          .markTermDeployed(potentialTermAddress.address),
      ).to.be.revertedWith("Contract is already in Term");
    });
    it("Removing a term contract not marked in controller reverts", async () => {
      // Revert transaction if user is not granted role equal to keccak256("BURNER_ROLE")
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(false);
      await expect(
        termController
          .connect(controllerAdminWallet)
          .unmarkTermDeployed(potentialTermAddress.address),
      ).to.be.revertedWith("Contract is not in Term");
    });
  });
  it("Granting and revoking mint exposure access with approved admin wallet", async () => {
    expect(
      await termController.verifyMintExposureAccess(
        potentialTermAddress.address,
      ),
    ).eq(false);

    await expect(
      termController
        .connect(controllerAdminWallet)
        .grantMintExposureAccess(potentialTermAddress.address),
    ).to.be.reverted;

    await termController
      .connect(adminWallet)
      .grantMintExposureAccess(potentialTermAddress.address);

    expect(
      await termController.verifyMintExposureAccess(
        potentialTermAddress.address,
      ),
    ).eq(true);

    await expect(
      termController
        .connect(controllerAdminWallet)
        .revokeMintExposureAccess(potentialTermAddress.address),
    ).to.be.reverted;

    await termController
      .connect(adminWallet)
      .revokeMintExposureAccess(potentialTermAddress.address);

    expect(
      await termController.verifyMintExposureAccess(
        potentialTermAddress.address,
      ),
    ).eq(false);
  });
  it("new auction added successfully", async () => {
    await expect(termController.pairAuction(potentialTermAddress.address)).to.be
      .reverted;

    await termController.connect(initializer).pairAuction(auction.address);

    const termId = solidityKeccak256(["string"], ["termId"]);

    const auctionId = solidityKeccak256(["string"], ["auctionId"]);

    const auctionId2 = solidityKeccak256(["string"], ["auctionId2"]);

    await expect(
      termController
        .connect(potentialTermAddress)
        .recordAuctionResult(termId, auctionId, "100"),
    ).to.be.reverted;

    const addNewAuctionCompletionTx = await termController
      .connect(auction)
      .recordAuctionResult(termId, auctionId, "100");

    const tx = addNewAuctionCompletionTx.wait();
    const blockNumber = tx.blockNumber;
    const block = await ethers.provider.getBlock(blockNumber);

    await termController.connect(initializer).pairAuction(auction2.address);

    const addNewAuctionCompletionTx2 = await termController
      .connect(auction2)
      .recordAuctionResult(termId, auctionId2, "200");

    const tx2 = addNewAuctionCompletionTx2.wait();

    const termAuctionHistory =
      await termController.getTermAuctionResults(termId);

    const termAuctionHistoryJson = JSON.parse(
      JSON.stringify(termAuctionHistory),
    );

    const blockNumber2 = tx2.blockNumber;
    const block2 = await ethers.provider.getBlock(blockNumber2);

    console.log(block);
    console.log(block2);

    expect(termAuctionHistoryJson).to.deep.eq([
      [
        [
          auctionId,
          BigNumber.from("100").toJSON(),
          BigNumber.from(block.timestamp).toJSON(),
        ],
        [
          auctionId2,
          BigNumber.from("200").toJSON(),
          BigNumber.from(block2.timestamp).toJSON(),
        ],
      ],
      2,
    ]);
  });
  it("version returns the current contract version", async () => {
    expect(await termController.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
