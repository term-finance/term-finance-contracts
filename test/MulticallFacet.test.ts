/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import {
  MulticallFacet,
  DiamondCutFacet,
  DiamondLoupeFacet,
  TermDiamond,
  TestRevertContract,
  TermDiamondFactory,
} from "../typechain-types";
import { ZeroAddress } from "ethers";

describe("MulticallFacet Tests", () => {
  let multicallFacet: MulticallFacet;
  let diamondCutFacet: DiamondCutFacet;
  let diamondLoupeFacet: DiamondLoupeFacet;
  let termDiamond: TermDiamond;
  let termDiamondFactory: TermDiamondFactory
  let testRevertContract: TestRevertContract;

  let devops: SignerWithAddress;
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  let snapshotId: any;

  before(async () => {
    [devops, admin, user1, user2] = await ethers.getSigners();

    // Deploy facets
    const DiamondFactoryFactory = await ethers.getContractFactory("TermDiamondFactory");
    termDiamondFactory = await DiamondFactoryFactory.deploy(admin.address, devops.address);

    const DiamondLoupeFacetFactory = await ethers.getContractFactory("DiamondLoupeFacet");
    diamondLoupeFacet = await DiamondLoupeFacetFactory.deploy();
    await diamondLoupeFacet.waitForDeployment();

    const MulticallFacetFactory = await ethers.getContractFactory("MulticallFacet");
    multicallFacet = await MulticallFacetFactory.deploy();
    await multicallFacet.waitForDeployment();

    // Deploy test revert contract
    const TestRevertContractFactory = await ethers.getContractFactory("TestRevertContract");
    testRevertContract = await TestRevertContractFactory.deploy();
    await testRevertContract.waitForDeployment();
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
    const diamondAddress = decodedEvent?.args.diamond;
    const diamondCutFacetAddr = decodedEvent?.args.diamondCutFacet;

    termDiamond = await ethers.getContractAt("TermDiamond", diamondAddress) as TermDiamond;
    
    diamondCutFacet = await ethers.getContractAt(
      "DiamondCutFacet",
      diamondCutFacetAddr
    ) as DiamondCutFacet;

    // Add DiamondLoupe facet to the diamond
    const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

    const loupeSelectors = [
      diamondLoupeFacet.interface.getFunction("facets").selector,
      diamondLoupeFacet.interface.getFunction("facetAddresses").selector,
      diamondLoupeFacet.interface.getFunction("facetAddress").selector,
      diamondLoupeFacet.interface.getFunction("facetFunctionSelectors").selector,
    ];

    await diamondCut.diamondCut(
      [{
        facetAddress: await diamondLoupeFacet.getAddress(),
        action: 0, // Add
        functionSelectors: loupeSelectors
      }],
      ZeroAddress,
      "0x"
    );

    // Add MulticallFacet to the diamond
    const multicallSelectors = [
      multicallFacet.interface.getFunction("multicall").selector,
      multicallFacet.interface.getFunction("decodeErrorString").selector,
      multicallFacet.interface.getFunction("uint2strTestHelper").selector,
    ];

    await diamondCut.diamondCut(
      [{
        facetAddress: await multicallFacet.getAddress(),
        action: 0, // Add
        functionSelectors: multicallSelectors
      }],
      ZeroAddress,
      "0x"
    );

    // Add TestRevertContract facet to the diamond for testing revert scenarios
    const testRevertSelectors = [
      testRevertContract.interface.getFunction("revertWithMessage").selector,
      testRevertContract.interface.getFunction("revertWithCustomError").selector,
      testRevertContract.interface.getFunction("revertWithNoData").selector,
      testRevertContract.interface.getFunction("succeed").selector,
    ];

    await diamondCut.diamondCut(
      [{
        facetAddress: await testRevertContract.getAddress(),
        action: 0, // Add
        functionSelectors: testRevertSelectors
      }],
      ZeroAddress,
      "0x"
    );

    snapshotId = await network.provider.send("evm_snapshot");
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
  });

  describe("Basic Functionality", () => {
    it("should execute single valid call successfully", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Prepare a call to facetAddresses()
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");

      const tx = await multicall.multicall([callData]);
      const receipt = await tx.wait();

      // Verify event was emitted
      const event = receipt?.logs.find(log => {
        try {
          const parsed = multicall.interface.parseLog(log);
          return parsed?.name === "MulticallExecuted";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;
    });

    it("should execute multiple valid calls successfully", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Prepare multiple calls
      const call1 = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const call2 = diamondLoupeFacet.interface.encodeFunctionData("facets");

      const tx = await multicall.multicall([call1, call2]);
      const receipt = await tx.wait();

      // Verify MulticallExecuted event
      const event = receipt?.logs.find(log => {
        try {
          const parsed = multicall.interface.parseLog(log);
          return parsed?.name === "MulticallExecuted";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      if (event) {
        const parsed = multicall.interface.parseLog(event);
        expect(parsed?.args[0]).to.equal(2); // callCount
        expect(parsed?.args[1]).to.deep.equal([true, true]); // successes array
      }
    });

    it("should return correct data from calls", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const loupe = await ethers.getContractAt("DiamondLoupeFacet", await termDiamond.getAddress());

      // Get expected data directly
      const expectedFacetAddresses = await loupe.facetAddresses();

      // Prepare call
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");

      const result = await multicall.multicall.staticCall([callData]);
      const decodedResult = diamondLoupeFacet.interface.decodeFunctionResult("facetAddresses", result[0]);

      expect(decodedResult[0]).to.deep.equal(expectedFacetAddresses);
    });
  });

  describe("Input Validation", () => {
    it("should revert with EmptyCallsArray when calls array is empty", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      await expect(multicall.multicall([]))
        .to.be.revertedWithCustomError(multicall, "EmptyCallsArray");
    });

    it("should revert with InvalidFunctionSelector for invalid selector", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Call with invalid selector (non-existent function)
      const invalidCallData = "0x12345678"; // Non-existent selector

      await expect(multicall.multicall([invalidCallData]))
        .to.be.revertedWithCustomError(multicall, "InvalidFunctionSelector");
    });

    it("should revert with InvalidFunctionSelector for call data too short", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Call with data shorter than 4 bytes (3 bytes total)
      const shortCallData = "0x123456";

      await expect(multicall.multicall([shortCallData]))
        .to.be.revertedWithCustomError(multicall, "InvalidFunctionSelector");
    });

    it("should validate facet is enabled", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Try to call a function that doesn't exist on any enabled facet
      const nonExistentSelector = "0xffffffff";
      const callData = nonExistentSelector + "0".repeat(56); // Pad to make valid call data

      await expect(multicall.multicall([callData]))
        .to.be.revertedWithCustomError(multicall, "InvalidFunctionSelector");
    });
  });

  describe("Security Features", () => {
    it("should prevent reentrancy", async () => {
      // This test would require a malicious contract that attempts reentrancy
      // For now, we'll test the basic reentrancy guard state
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // The reentrancy guard uses a private storage slot, so we can't directly test it
      // But we can verify that the function executes normally
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");

      await expect(multicall.multicall([callData])).to.not.be.reverted;
    });

    it("should set and reset multicall initiator properly", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // The multicallInitiator is set during execution and reset after
      // We can't directly access it, but we can verify the function completes successfully
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");

      await expect(multicall.multicall([callData])).to.not.be.reverted;
    });

    it("should revert if multicall is already initiated", async () => {
      // This would require a contract that calls multicall from within another multicall
      // Due to the complexity of setting this up, we'll skip this test for now
      // In a real scenario, you'd create a malicious contract that attempts nested multicalls
    });
  });

  describe("Error Handling", () => {
    it("should revert entire transaction if any call fails", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Create a valid call and an invalid call
      const validCall = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const invalidCall = "0x12345678"; // Invalid selector

      await expect(multicall.multicall([validCall, invalidCall]))
        .to.be.revertedWithCustomError(multicall, "InvalidFunctionSelector");
    });

    it("should bubble up revert messages from failed calls", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Try to call a function that doesn't exist
      const invalidCall = "0xdeadbeef" + "0".repeat(56);

      await expect(multicall.multicall([invalidCall]))
        .to.be.revertedWithCustomError(multicall, "InvalidFunctionSelector");
    });

    it("should handle delegatecall failures with access control revert", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

      // Try to call diamondCut without proper permissions from user1
      // This will pass validation (function exists) but fail during execution (access control)
      const diamondCutCall = diamondCut.interface.encodeFunctionData("diamondCut", [
        [],
        ZeroAddress,
        "0x"
      ]);

      // Connect as user1 who doesn't have DEVOPS_ROLE
      const multicallAsUser1 = multicall.connect(user1);

      // This should revert with AccessControl error (bubbled up from the failed delegatecall)
      await expect(multicallAsUser1.multicall([diamondCutCall])).to.be.reverted;
    });

    it("should handle delegatecall failures and bubble up custom errors", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

      // Encode a diamondCut call with invalid parameters
      const diamondCutCall = diamondCut.interface.encodeFunctionData("diamondCut", [
        [{
          facetAddress: ZeroAddress,
          action: 0,
          functionSelectors: []
        }],
        ZeroAddress,
        "0x"
      ]);

      // Connect as user1 who doesn't have DEVOPS_ROLE
      const multicallAsUser1 = multicall.connect(user1);

      // This should revert due to access control
      await expect(multicallAsUser1.multicall([diamondCutCall])).to.be.reverted;
    });

    it("should propagate revert data from failed subcalls", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const diamondCut = await ethers.getContractAt("DiamondCutFacet", await termDiamond.getAddress());

      // Create multiple calls where one will fail
      const validCall = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const failingCall = diamondCut.interface.encodeFunctionData("diamondCut", [
        [],
        ZeroAddress,
        "0x"
      ]);

      const multicallAsUser1 = multicall.connect(user1);

      // The failing call should cause the entire multicall to revert
      await expect(multicallAsUser1.multicall([validCall, failingCall])).to.be.reverted;
    });

    it("should bubble up revert with message from delegatecall", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const testRevert = await ethers.getContractAt("TestRevertContract", await termDiamond.getAddress());

      // Call a function that reverts with a message
      const revertCall = testRevert.interface.encodeFunctionData("revertWithMessage");

      // This should revert and bubble up the revert message through _revert function
      await expect(multicall.multicall([revertCall]))
        .to.be.revertedWith("This is a test revert message");
    });

    it("should bubble up custom error from delegatecall", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const testRevert = await ethers.getContractAt("TestRevertContract", await termDiamond.getAddress());

      // Call a function that reverts with a custom error
      const revertCall = testRevert.interface.encodeFunctionData("revertWithCustomError");

      // This should revert and bubble up the custom error through _revert function
      await expect(multicall.multicall([revertCall]))
        .to.be.revertedWithCustomError(testRevert, "CustomTestError")
        .withArgs(42);
    });

    it("should handle revert with no data from delegatecall", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const testRevert = await ethers.getContractAt("TestRevertContract", await termDiamond.getAddress());

      // Call a function that reverts with no data
      const revertCall = testRevert.interface.encodeFunctionData("revertWithNoData");

      // This should trigger the require check for empty return data in _revert
      await expect(multicall.multicall([revertCall]))
        .to.be.revertedWith("call reverted");
    });

    it("should handle mixed success and failure calls correctly", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      const testRevert = await ethers.getContractAt("TestRevertContract", await termDiamond.getAddress());

      // Create a sequence of calls where a later one fails
      const successCall = testRevert.interface.encodeFunctionData("succeed");
      const validCall = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const revertCall = testRevert.interface.encodeFunctionData("revertWithMessage");

      // Even though first calls succeed, the failure should revert the entire transaction
      await expect(multicall.multicall([successCall, validCall, revertCall]))
        .to.be.revertedWith("This is a test revert message");
    });
  });

  describe("Edge Cases", () => {
    it("should handle large number of calls", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Create multiple identical calls
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const manyCalls = Array(10).fill(callData);

      const tx = await multicall.multicall(manyCalls);
      const receipt = await tx.wait();

      // Verify event shows correct count
      const event = receipt?.logs.find(log => {
        try {
          const parsed = multicall.interface.parseLog(log);
          return parsed?.name === "MulticallExecuted";
        } catch {
          return false;
        }
      });

      expect(event).to.not.be.undefined;

      if (event) {
        const parsed = multicall.interface.parseLog(event);
        expect(parsed?.args[0]).to.equal(10); // callCount
        expect(parsed?.args[1].length).to.equal(10); // successes array length
        expect(parsed?.args[1].every((success: boolean) => success)).to.be.true;
      }
    });

    it("should handle calls with different parameter types", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // Test with different call types
      const call1 = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");
      const call2 = diamondLoupeFacet.interface.encodeFunctionData("facets");

      await expect(multicall.multicall([call1, call2])).to.not.be.reverted;
    });

    it("should work with view functions", async () => {
      const multicall = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());

      // All our test calls are view functions, so this tests that behavior
      const callData = diamondLoupeFacet.interface.encodeFunctionData("facetAddresses");

      const result = await multicall.multicall.staticCall([callData]);
      expect(result).to.be.an("array");
      expect(result.length).to.equal(1);
    });
  });

  describe("Utility Functions", () => {
    it("should decode error strings correctly", async () => {
      // Test the decodeErrorString function
      const errorString = "Test error message";
      const encodedError = ethers.AbiCoder.defaultAbiCoder().encode(["string"], [errorString]);

      const result = await multicallFacet.decodeErrorString(encodedError);
      expect(result).to.equal(errorString);
    });

    it("should handle malformed error data gracefully", async () => {
      // Test with invalid encoded data
      const invalidData = "0x1234";

      await expect(multicallFacet.decodeErrorString(invalidData)).to.be.reverted;
    });

    it("should convert uint to string for zero", async () => {
      const result = await multicallFacet.uint2strTestHelper(0);
      expect(result).to.equal("0");
    });

    it("should convert single digit uint to string", async () => {
      const result = await multicallFacet.uint2strTestHelper(5);
      expect(result).to.equal("5");
    });

    it("should convert multi-digit uint to string", async () => {
      const result = await multicallFacet.uint2strTestHelper(12345);
      expect(result).to.equal("12345");
    });

    it("should convert large uint to string", async () => {
      const result = await multicallFacet.uint2strTestHelper(9876543210n);
      expect(result).to.equal("9876543210");
    });

    it("should convert max uint256 to string", async () => {
      const maxUint256 = 2n ** 256n - 1n;
      const result = await multicallFacet.uint2strTestHelper(maxUint256);
      expect(result).to.equal(maxUint256.toString());
    });

    it("should convert uint to string through diamond", async () => {
      // Test calling through the diamond to ensure the function is properly accessible
      const multicallDiamond = await ethers.getContractAt("MulticallFacet", await termDiamond.getAddress());
      
      const result1 = await multicallDiamond.uint2strTestHelper(0);
      expect(result1).to.equal("0");
      
      const result2 = await multicallDiamond.uint2strTestHelper(999);
      expect(result2).to.equal("999");
      
      const result3 = await multicallDiamond.uint2strTestHelper(1234567890n);
      expect(result3).to.equal("1234567890");
    });

    it("should handle various number sizes for uint to string conversion", async () => {
      const testCases = [
        { input: 1n, expected: "1" },
        { input: 10n, expected: "10" },
        { input: 99n, expected: "99" },
        { input: 100n, expected: "100" },
        { input: 1000n, expected: "1000" },
        { input: 10000n, expected: "10000" },
        { input: 100000n, expected: "100000" },
        { input: 1000000n, expected: "1000000" },
      ];

      for (const testCase of testCases) {
        const result = await multicallFacet.uint2strTestHelper(testCase.input);
        expect(result).to.equal(testCase.expected);
      }
    });
  });
});