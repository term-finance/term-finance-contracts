import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, constants } from "ethers";
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
  let devopsWallet: SignerWithAddress;

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
      devopsWallet,
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
        adminWallet.address,
        devopsWallet.address,
      ],
      {
        kind: "uups",
      },
    );
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
    it("Revert if treasury wallet is zero address", async () => {
      const TermController =
        await ethers.getContractFactory("TestTermController");

      await expect(
        upgrades.deployProxy(
          TermController,
          [
            ethers.constants.AddressZero,
            originalProtocolReservesAddress.address,
            adminWallet.address,
            devopsWallet.address,
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
            adminWallet.address,
            devopsWallet.address,
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
            adminWallet.address,
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
            adminWallet.address,
            constants.AddressZero,
          ),
      ).to.be.revertedWith(
        "New Controller Admin Wallet cannot be zero address",
      );

      await termController
        .connect(devopsWallet)
        .updateControllerAdminWallet(
          adminWallet.address,
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
        .connect(adminWallet)
        .markTermDeployed(potentialTermAddress.address);
      expect(
        await termController
          .connect(externalAddress)
          .isTermDeployed(potentialTermAddress.address),
      ).to.equal(true);
      await termController
        .connect(adminWallet)
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
        .connect(adminWallet)
        .markTermDeployed(potentialTermAddress.address);
      await expect(
        termController
          .connect(adminWallet)
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
          .connect(adminWallet)
          .unmarkTermDeployed(potentialTermAddress.address),
      ).to.be.revertedWith("Contract is not in Term");
    });
  });
  it("version returns the current contract version", async () => {
    expect(await termController.version()).to.eq(expectedVersion);
  });
});
/* eslint-enable camelcase */
