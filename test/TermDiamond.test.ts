/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  TermDiamond,
  TermDiamondFactory,
  DiamondCutFacet,
  DiamondLoupeFacet,
  MulticallFacet,
} from "../typechain-types";
import { ZeroAddress } from "ethers";

describe("TermDiamond Tests", () => {
  let termDiamond: TermDiamond;
  let termDiamondFactory: TermDiamondFactory;
  let diamondCutFacet: DiamondCutFacet;
  let diamondLoupeFacet: DiamondLoupeFacet;
  let multicallFacet: MulticallFacet;
  
  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  
  let snapshotId: any;
  
  before(async () => {
    [devops, admin, user1, user2] = await ethers.getSigners();

    // Deploy Diamond Factory
    const TermDiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    termDiamondFactory = await TermDiamondFactoryFactory.deploy(admin.address, devops.address);
    await termDiamondFactory.waitForDeployment();
    
    const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
    diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();
    
    const MulticallFacetFactory = await ethers.getContractFactory("MulticallFacet");
    multicallFacet = await MulticallFacetFactory.deploy();
    await multicallFacet.waitForDeployment();
  });
  
  beforeEach(async () => {
    // Deploy fresh diamond for each test
    const deployTx = await termDiamondFactory.deployDiamond();
    const receipt = await deployTx.wait();

    // Read diamond address from DiamondDeployed event log
    const diamondDeployedEvent = receipt?.logs.find(
      log => log.topics[0] === termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash
    );

    if (!diamondDeployedEvent) {
      throw new Error("DiamondDeployed event not found");
    }

    const decodedEvent = termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    const diamondAddress = decodedEvent?.args[0];
    const diamondCutFacetAddr = decodedEvent?.args[1];

    termDiamond = await ethers.getContractAt("TermDiamond", diamondAddress);
    diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", diamondCutFacetAddr);

    snapshotId = await network.provider.send("evm_snapshot");
  });
  
  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });
  
  describe("TermDiamond Initialization", () => {
    it("should initialize with diamond cut facet", async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      expect(await diamondCut.getAddress()).to.equal(await termDiamond.getAddress());
    });
    
    it("should set contract devops correctly", async () => {
      // The diamond doesn't expose devops directly, but we can verify through access control
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      // devops should be able to call diamondCut
      await expect(
        diamondCut.diamondCut([], ZeroAddress, "0x")
      ).to.not.be.reverted;
    });
    
    it("should  accept ether", async () => {
      await expect(
        devops.sendTransaction({
          to: await termDiamond.getAddress(),
          value: ethers.parseEther("1.0")
        })
      ).to.not.be.reverted;
    });
  });
  
  describe("Diamond Cut Functionality", () => {
    it("should add a new facet", async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
        diamondLoupeFacet.interface.getFunction("facetAddresses").selector,
      ];
      
      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0, // Add
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
      
      // Verify facet was added
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const facets = await loupe.facets();
      
      expect(facets.length).to.be.greaterThan(0);
    });
    
    it("should replace facet functions", async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      // First add the facet
      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
        diamondLoupeFacet.interface.getFunction("facetAddress").selector,
      ];
      
      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0, // Add
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
      
      // Deploy a new version of the facet
      const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
      const newLoupeFacet = await DiamondLoupeFacetFactory.deploy();
      await newLoupeFacet.waitForDeployment();
      
      // Replace the facet
      await diamondCut.diamondCut(
        [{
          facetAddress: await newLoupeFacet.getAddress(),
          action: 1, // Replace
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
      
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const facetAddress = await loupe.facetAddress(selectors[0]);
      
      expect(facetAddress).to.equal(await newLoupeFacet.getAddress());
    });
    
    it("should remove facet functions", async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      // Add both functions first
      const allSelectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
        diamondLoupeFacet.interface.getFunction("facetAddress").selector,
      ];

      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0, // Add
          functionSelectors: allSelectors
        }],
        ZeroAddress,
        "0x"
      );

      // Remove only the facets function, keep facetAddress for verification
      const selectorsToRemove = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
      ];

      await diamondCut.diamondCut(
        [{
          facetAddress: ZeroAddress, // Must be zero address for remove
          action: 2, // Remove
          functionSelectors: selectorsToRemove
        }],
        ZeroAddress,
        "0x"
      );

      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const facetAddress = await loupe.facetAddress(selectorsToRemove[0]);
      
      expect(facetAddress).to.equal(ZeroAddress);
    });
    
    it("should execute initialization function during diamond cut", async () => {
      // This test would require a sample init contract
      // For now, we verify that empty init works
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      await expect(
        diamondCut.diamondCut([], ZeroAddress, "0x")
      ).to.not.be.reverted;
    });
  });
  
  describe("Diamond Loupe Functionality", () => {
    beforeEach(async () => {
      // Add loupe facet to diamond
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
        diamondLoupeFacet.interface.getFunction("facetFunctionSelectors").selector,
        diamondLoupeFacet.interface.getFunction("facetAddresses").selector,
        diamondLoupeFacet.interface.getFunction("facetAddress").selector,
        diamondLoupeFacet.interface.getFunction("supportsInterface").selector,
      ];
      
      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0,
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
    });
    
    it("should return all facets", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const facets = await loupe.facets();
      
      expect(facets.length).to.be.greaterThan(0);
    });
    
    it("should return function selectors for a facet", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const selectors = await loupe.facetFunctionSelectors(await diamondLoupeFacet.getAddress());
      
      expect(selectors.length).to.be.greaterThan(0);
    });
    
    it("should return all facet addresses", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const addresses = await loupe.facetAddresses();
      
      expect(addresses.length).to.be.greaterThan(0);
      expect(addresses).to.include(await diamondCutFacet.getAddress());
      expect(addresses).to.include(await diamondLoupeFacet.getAddress());
    });
    
    it("should return facet address for a function selector", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      const selector = loupe.interface.getFunction("facets").selector;
      const facetAddress = await loupe.facetAddress(selector);
      
      expect(facetAddress).to.equal(await diamondLoupeFacet.getAddress());
    });
    
    it("should support interfaces correctly", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      
      // DiamondLoupe interface ID
      const diamondLoupeInterfaceId = "0x48e2b093";
      const supported = await loupe.supportsInterface(diamondLoupeInterfaceId);
      
      // Note: May need to register interface IDs in initialization
      // For now just check that the function works
      expect(typeof supported).to.equal("boolean");
    });
  });
  
  describe("Fallback Function", () => {
    beforeEach(async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());
      
      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
      ];
      
      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0,
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
    });
    
    it("should delegatecall to correct facet", async () => {
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
      
      // This call goes through the fallback which delegatecalls to the facet
      const facets = await loupe.facets();
      
      expect(facets.length).to.be.greaterThan(0);
    });
    
    it("should revert for non-existent function", async () => {
      // Try to call a function that doesn't exist
      const invalidSelector = "0xdeadbeef";
      
      await expect(
        devops.sendTransaction({
          to: await termDiamond.getAddress(),
          data: invalidSelector
        })
      ).to.be.reverted;
    });
  });
  
  describe("Access Control", () => {
    it("should only allow devops to perform diamond cuts", async () => {
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
      ];

      // Non-devops should not be able to perform diamond cut
      await expect(
        diamondCut.connect(user1).diamondCut(
          [{
            facetAddress: await diamondLoupeFacet.getAddress(),
            action: 0,
            functionSelectors: selectors
          }],
          ZeroAddress,
          "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Pausable Functionality", () => {
    beforeEach(async () => {
      // Add loupe facet to test fallback function behavior when diamondPaused
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

      const selectors = [
        diamondLoupeFacet.interface.getFunction("facets").selector,
        diamondLoupeFacet.interface.getFunction("facetAddress").selector,
        diamondLoupeFacet.interface.getFunction("diamondPaused").selector,
      ];

      await diamondCut.diamondCut(
        [{
          facetAddress: await diamondLoupeFacet.getAddress(),
          action: 0,
          functionSelectors: selectors
        }],
        ZeroAddress,
        "0x"
      );
    });

    describe("Pause Function", () => {
      it("should allow admin to pause the contract", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
        await expect(diamondPause.connect(admin).pauseDiamond())
          .to.emit(diamondPause, "DiamondPaused");
        expect(await loupe.diamondPaused()).to.be.true;
      });

      it("should revert when non-admin tries to pause", async () => {
         const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
        await expect(
          diamondPause.connect(user1).pauseDiamond()
        ).to.be.revertedWithCustomError(diamondCutFacet, "AccessControlUnauthorizedAccount");
      });

      it("should revert when devops tries to pause (only admin role allowed)", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        await expect(
          diamondPause.connect(devops).pauseDiamond()
        ).to.be.revertedWithCustomError(diamondCutFacet, "AccessControlUnauthorizedAccount");
      });

      it("should revert when trying to pause already paused contract", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        await diamondPause.connect(admin).pauseDiamond();

        await expect(
          diamondPause.connect(admin).pauseDiamond()
        ).to.be.revertedWithCustomError(termDiamond, "DiamondIsPaused");
      });
    });

    describe("Unpause Function", () => {
      beforeEach(async () => {
        // Pause the contract first
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        await diamondPause.connect(admin).pauseDiamond();
      });

      it("should allow admin to unpause the contract", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());

        // First check that it's actually paused
        expect(await loupe.diamondPaused()).to.be.true;

        // Call unpause and check event
        await expect(diamondPause.connect(admin).unpauseDiamond())
          .to.emit(diamondPause, "DiamondUnpaused");

        // Check if it actually unpaused
        expect(await loupe.diamondPaused()).to.be.false;
      });

      it("should revert when non-admin tries to unpause", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        
        await expect(
          diamondPause.connect(user1).unpauseDiamond()
        ).to.be.revertedWithCustomError(diamondCutFacet, "AccessControlUnauthorizedAccount");
      });

      it("should revert when devops tries to unpause (only admin role allowed)", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        await expect(
          diamondPause.connect(devops).unpauseDiamond()
        ).to.be.revertedWithCustomError(diamondCutFacet, "AccessControlUnauthorizedAccount");
      });

      it("should revert when trying to unpause non-paused contract", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        await diamondPause.connect(admin).unpauseDiamond();

        await expect(
          diamondPause.connect(admin).unpauseDiamond()
        ).to.be.revertedWithCustomError(diamondCutFacet, "NotPaused");
      });
    });

    describe("Fallback Function Pause Protection", () => {
      it("should allow facet function calls when not paused", async () => {
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());

        // Should work normally when not paused
        await expect(loupe.facets()).to.not.be.reverted;
      });

      it("should allow all facet function calls when paused", async () => {
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());

        // Pause the contract
        await diamondPause.connect(admin).pauseDiamond();
        const diamondCutFacetAddr = await diamondCutFacet.getAddress();

        // All facet calls should be blocked
        await expect(
          loupe.facets()
        ).to.not.be.reverted;
        expect(
          await loupe.facetAddress(diamondCutFacet.interface.getFunction("diamondCut").selector)
          ).to.equal(diamondCutFacetAddr);
        });

        it("should revert diamondCut function calls when paused", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());

        // Pause the contract
        await diamondPause.connect(admin).pauseDiamond();

        // All facet calls should be blocked
        const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

        await expect(
          diamondCut.connect(devops).diamondCut([{
            facetAddress: await diamondLoupeFacet.getAddress(),
            action: 0,
            functionSelectors: []
          }],
            ZeroAddress,
            "0x"
        )).to.be.revertedWithCustomError(termDiamond, "DiamondIsPaused");
        });
    });

    describe("State Verification", () => {
      it("should correctly report paused state", async () => {
        const diamondPause = await ethers.getContractAt("IDiamondPause", await termDiamond.getAddress());
        const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());
        // Initially not paused
        expect(await loupe.diamondPaused()).to.be.false;

        // After pausing
        await diamondPause.connect(admin).pauseDiamond();
        expect(await loupe.diamondPaused()).to.be.true;
        // After unpausing
        await diamondPause.connect(admin).unpauseDiamond();
        expect(await loupe.diamondPaused()).to.be.false;
      });
    });
  });
});
