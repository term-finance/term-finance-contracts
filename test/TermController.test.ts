import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ZeroAddress, solidityPackedKeccak256 } from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { TermController, TermController__factory } from "../typechain-types";

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

  let newTermController: TermController;
  let termController: TermController;

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
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();

    const TermController =
      await ethers.getContractFactory("TestTermController");

    termController = (await upgrades.deployProxy(
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
    )) as unknown as TermController;
    newTermController =
      (await TermController.deploy()) as unknown as TermController;

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
      await termController
        .connect(devopsWallet)
        .upgradeToAndCall(await newTermController.getAddress(), "0x");

      await expect(
        termController
          .connect(externalAddress)
          .upgradeToAndCall(externalAddress.address, "0x"),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
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
            ZeroAddress,
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
            ZeroAddress,
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
            ZeroAddress,
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
            ZeroAddress,
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
            ZeroAddress,
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
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );

      await expect(
        termController
          .connect(externalAddress)
          .updateProtocolReserveAddress(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });
    it("External Addresses cannot add or remove a Term Finance Address", async () => {
      // Revert transaction if user is not granted role equal to keccak256("MINTER_ROLE")
      await expect(
        termController
          .connect(externalAddress)
          .markTermDeployed(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );

      await expect(
        termController
          .connect(externalAddress)
          .unmarkTermDeployed(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
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
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
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
            ZeroAddress,
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
            ZeroAddress,
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

    const termId = solidityPackedKeccak256(["string"], ["termId"]);

    const auctionId = solidityPackedKeccak256(["string"], ["auctionId"]);

    const auctionId2 = solidityPackedKeccak256(["string"], ["auctionId2"]);

    await expect(
      termController
        .connect(potentialTermAddress)
        .recordAuctionResult(termId, auctionId, "100"),
    ).to.be.reverted;

    const addNewAuctionCompletionTx = await termController
      .connect(auction)
      .recordAuctionResult(termId, auctionId, "100");

    const tx = await addNewAuctionCompletionTx.wait();
    const blockNumber = tx?.blockNumber!;
    const block = await ethers.provider.getBlock(blockNumber);

    await termController.connect(initializer).pairAuction(auction2.address);

    const addNewAuctionCompletionTx2 = await termController
      .connect(auction2)
      .recordAuctionResult(termId, auctionId2, "200");

    const tx2 = await addNewAuctionCompletionTx2.wait();

    const termAuctionHistory =
      await termController.getTermAuctionResults(termId);

    const blockNumber2 = tx2?.blockNumber!;
    const block2 = await ethers.provider.getBlock(blockNumber2);

    console.log(block);
    console.log(block2);

    expect(termAuctionHistory).to.deep.eq([
      [
        [auctionId, 100n, BigInt(block?.timestamp!)],
        [auctionId2, 200n, BigInt(block2?.timestamp!)],
      ],
      2,
    ]);
  });
  it("version returns the current contract version", async () => {
    expect(await termController.version()).to.eq(expectedVersion);
  });

  describe("pairFactoryDeployer", async () => {
    it("reverts if called by non-admin", async () => {
      await expect(
        termController
          .connect(externalAddress)
          .pairFactoryDeployer(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("grants FACTORY_DEPLOYER_ROLE allowing markTermFactoryDeployed", async () => {
      await termController
        .connect(adminWallet)
        .pairFactoryDeployer(potentialTermAddress.address);

      await expect(
        termController
          .connect(potentialTermAddress)
          .markTermFactoryDeployed(externalAddress.address),
      ).to.not.be.reverted;
    });
  });

  describe("isFactoryDeployed, markTermFactoryDeployed, unmarkTermFactoryDeployed", async () => {
    beforeEach(async () => {
      await termController
        .connect(adminWallet)
        .pairFactoryDeployer(potentialTermAddress.address);
    });

    it("isFactoryDeployed returns false for an unknown address", async () => {
      expect(
        await termController.isFactoryDeployed(externalAddress.address),
      ).to.equal(false);
    });

    it("markTermFactoryDeployed reverts without FACTORY_DEPLOYER_ROLE", async () => {
      await expect(
        termController
          .connect(externalAddress)
          .markTermFactoryDeployed(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("markTermFactoryDeployed succeeds and isFactoryDeployed returns true", async () => {
      await termController
        .connect(potentialTermAddress)
        .markTermFactoryDeployed(externalAddress.address);

      expect(
        await termController.isFactoryDeployed(externalAddress.address),
      ).to.equal(true);
    });

    it("markTermFactoryDeployed reverts if address is already marked", async () => {
      await termController
        .connect(potentialTermAddress)
        .markTermFactoryDeployed(externalAddress.address);

      await expect(
        termController
          .connect(potentialTermAddress)
          .markTermFactoryDeployed(externalAddress.address),
      ).to.be.revertedWith(
        "Contract is already marked deployed by factory",
      );
    });

    it("unmarkTermFactoryDeployed reverts without CONTROLLER_ADMIN_ROLE", async () => {
      await termController
        .connect(potentialTermAddress)
        .markTermFactoryDeployed(externalAddress.address);

      await expect(
        termController
          .connect(externalAddress)
          .unmarkTermFactoryDeployed(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("unmarkTermFactoryDeployed reverts if address is not marked", async () => {
      await expect(
        termController
          .connect(controllerAdminWallet)
          .unmarkTermFactoryDeployed(externalAddress.address),
      ).to.be.revertedWith("Contract is not marked deployed by factory");
    });

    it("unmarkTermFactoryDeployed succeeds and isFactoryDeployed returns false", async () => {
      await termController
        .connect(potentialTermAddress)
        .markTermFactoryDeployed(externalAddress.address);

      await termController
        .connect(controllerAdminWallet)
        .unmarkTermFactoryDeployed(externalAddress.address);

      expect(
        await termController.isFactoryDeployed(externalAddress.address),
      ).to.equal(false);
    });
  });

  describe("isTermApproved, markTermApproved, unmarkTermApproved", async () => {
    it("isTermApproved returns false for an unknown address", async () => {
      expect(
        await termController.isTermApproved(externalAddress.address),
      ).to.equal(false);
    });

    it("markTermApproved reverts without ADMIN_ROLE", async () => {
      await expect(
        termController
          .connect(externalAddress)
          .markTermApproved(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("markTermApproved succeeds and isTermApproved returns true", async () => {
      await termController
        .connect(adminWallet)
        .markTermApproved(externalAddress.address);

      expect(
        await termController.isTermApproved(externalAddress.address),
      ).to.equal(true);
    });

    it("markTermApproved reverts if address is already approved", async () => {
      await termController
        .connect(adminWallet)
        .markTermApproved(externalAddress.address);

      await expect(
        termController
          .connect(adminWallet)
          .markTermApproved(externalAddress.address),
      ).to.be.revertedWith("Contract is already approved");
    });

    it("unmarkTermApproved reverts without ADMIN_ROLE", async () => {
      await termController
        .connect(adminWallet)
        .markTermApproved(externalAddress.address);

      await expect(
        termController
          .connect(controllerAdminWallet)
          .unmarkTermApproved(externalAddress.address),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("unmarkTermApproved reverts if address is not approved", async () => {
      await expect(
        termController
          .connect(adminWallet)
          .unmarkTermApproved(externalAddress.address),
      ).to.be.revertedWith("Contract is not approved");
    });

    it("unmarkTermApproved succeeds and isTermApproved returns false", async () => {
      await termController
        .connect(adminWallet)
        .markTermApproved(externalAddress.address);

      await termController
        .connect(adminWallet)
        .unmarkTermApproved(externalAddress.address);

      expect(
        await termController.isTermApproved(externalAddress.address),
      ).to.equal(false);
    });
  });

  describe("pauseTermContracts and unpauseTermContracts", async () => {
    it("pauseTermContracts reverts without ADMIN_ROLE", async () => {
      await expect(
        termController.connect(externalAddress).pauseTermContracts(),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("pauseTermContracts sets termContractsPaused to true", async () => {
      expect(await termController.termContractsPaused()).to.equal(false);
      await termController.connect(adminWallet).pauseTermContracts();
      expect(await termController.termContractsPaused()).to.equal(true);
    });

    it("unpauseTermContracts reverts without ADMIN_ROLE", async () => {
      await termController.connect(adminWallet).pauseTermContracts();
      await expect(
        termController.connect(externalAddress).unpauseTermContracts(),
      ).to.be.revertedWithCustomError(
        termController,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("unpauseTermContracts sets termContractsPaused to false", async () => {
      await termController.connect(adminWallet).pauseTermContracts();
      expect(await termController.termContractsPaused()).to.equal(true);
      await termController.connect(adminWallet).unpauseTermContracts();
      expect(await termController.termContractsPaused()).to.equal(false);
    });
  });

  describe("updateControllerAdminWallet missing branch", async () => {
    it("reverts when oldControllerAdminWallet does not have CONTROLLER_ADMIN_ROLE", async () => {
      await expect(
        termController
          .connect(devopsWallet)
          .updateControllerAdminWallet(
            externalAddress.address,
            newTreasuryAddress.address,
          ),
      ).to.be.revertedWith("incorrect old controller admin wallet address");
    });
  });

  describe("registerRepoId and registerAuctionId", async () => {
    beforeEach(async () => {
      await termController
        .connect(adminWallet)
        .pairFactoryDeployer(potentialTermAddress.address);
    });

    it("registerRepoId reverts when called by unauthorized address", async () => {
      const repoId = solidityPackedKeccak256(["string"], ["someRepoId"]);
      await expect(
        termController.connect(externalAddress).registerRepoId(repoId),
      ).to.be.revertedWith("Unauthorized");
    });

    it("registerRepoId succeeds with INITIALIZER_ROLE and sets mapping to true", async () => {
      const repoId = solidityPackedKeccak256(["string"], ["someRepoId"]);
      expect(await termController.registeredRepoIds(repoId)).to.equal(false);
      await termController.connect(initializer).registerRepoId(repoId);
      expect(await termController.registeredRepoIds(repoId)).to.equal(true);
    });

    it("registerRepoId succeeds with FACTORY_DEPLOYER_ROLE and sets mapping to true", async () => {
      const repoId = solidityPackedKeccak256(["string"], ["someRepoId2"]);
      await termController.connect(potentialTermAddress).registerRepoId(repoId);
      expect(await termController.registeredRepoIds(repoId)).to.equal(true);
    });

    it("registerAuctionId reverts when called by unauthorized address", async () => {
      const auctionId = solidityPackedKeccak256(["string"], ["someAuctionId"]);
      await expect(
        termController.connect(externalAddress).registerAuctionId(auctionId),
      ).to.be.revertedWith("Unauthorized");
    });

    it("registerAuctionId succeeds with INITIALIZER_ROLE and sets mapping to true", async () => {
      const auctionId = solidityPackedKeccak256(["string"], ["someAuctionId"]);
      expect(await termController.registeredAuctionIds(auctionId)).to.equal(false);
      await termController.connect(initializer).registerAuctionId(auctionId);
      expect(await termController.registeredAuctionIds(auctionId)).to.equal(true);
    });

    it("registerAuctionId succeeds with FACTORY_DEPLOYER_ROLE and sets mapping to true", async () => {
      const auctionId = solidityPackedKeccak256(["string"], ["someAuctionId2"]);
      await termController.connect(potentialTermAddress).registerAuctionId(auctionId);
      expect(await termController.registeredAuctionIds(auctionId)).to.equal(true);
    });
  });
});
/* eslint-enable camelcase */
