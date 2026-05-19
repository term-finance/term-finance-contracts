/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  TermDiamond,
  TermDiamondFactory,
  DiamondCutFacet,
} from "../typechain-types";
import { ZeroAddress } from "ethers";

describe("TermDiamondFactory Tests", () => {
  let termDiamondFactory: TermDiamondFactory;

  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;

  let snapshotId: any;

  before(async () => {
    [devops, admin, user1] = await ethers.getSigners();

    // Deploy Diamond Factory
    const TermDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    termDiamondFactory = await TermDiamondFactoryFactory.deploy(admin.address, devops.address);
    await termDiamondFactory.waitForDeployment();
  });

  beforeEach(async () => {
    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("deployDiamond", () => {
    it("should deploy diamond and diamondCutFacet successfully", async () => {
      const tx = await termDiamondFactory.deployDiamond();
      const receipt = await tx.wait();

      // Find DiamondDeployed event
      const diamondDeployedEvent = receipt?.logs.find(
        log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
      );

      expect(diamondDeployedEvent).to.not.be.undefined;

      if (diamondDeployedEvent) {
        const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
        const diamondAddress = decodedEvent?.args[0];
        const diamondCutFacetAddr = decodedEvent?.args[1];

        // Verify addresses are not zero
        expect(diamondAddress).to.not.equal(ZeroAddress);
        expect(diamondCutFacetAddr).to.not.equal(ZeroAddress);

        // Verify diamond exists at address
        const code = await ethers.provider.getCode(diamondAddress);
        expect(code).to.not.equal("0x");

        // Verify diamondCutFacet exists at address
        const facetCode = await ethers.provider.getCode(diamondCutFacetAddr);
        expect(facetCode).to.not.equal("0x");
      }
    });

    it("should return diamond and diamondCutFacet addresses", async () => {
      // Use staticCall to get return values
      const [diamond, diamondCutFacet] = await termDiamondFactory.deployDiamond.staticCall();

      expect(diamond).to.not.equal(ZeroAddress);
      expect(diamondCutFacet).to.not.equal(ZeroAddress);
    });

    it("should allow devops to perform diamond cuts on deployed diamond", async () => {
      const tx = await termDiamondFactory.deployDiamond();
      const receipt = await tx.wait();

      const diamondDeployedEvent = receipt?.logs.find(
        log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
      );

      const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent!);
      const diamondAddress = decodedEvent?.args[0];

      const diamondCut = await ethers.getContractAt("DiamondCutFacet", diamondAddress);

      // devops should be able to call diamondCut
      await expect(
        diamondCut.connect(devops).diamondCut([], ZeroAddress, "0x")
      ).to.not.be.reverted;
    });

    it("should not allow non-devops to perform diamond cuts", async () => {
      const tx = await termDiamondFactory.deployDiamond();
      const receipt = await tx.wait();

      const diamondDeployedEvent = receipt?.logs.find(
        log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
      );

      const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent!);
      const diamondAddress = decodedEvent?.args[1];

      const diamondCut = await ethers.getContractAt("DiamondCutFacet", diamondAddress);

      // user1 should not be able to call diamondCut
      await expect(
        diamondCut.connect(user1).diamondCut([], ZeroAddress, "0x")
      ).to.be.reverted;
    });
  });
});
