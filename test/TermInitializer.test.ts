/* eslint-disable camelcase */
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  ITermController,
  ITermController__factory,
  ITermEventEmitter,
  ITermEventEmitter__factory,
  TermAuction,
  TermAuction__factory,
  TermAuctionBidLocker,
  TermAuctionBidLocker__factory,
  TermAuctionOfferLocker,
  TermAuctionOfferLocker__factory,
  TermInitializer,
  TermRepoCollateralManager,
  TermRepoCollateralManager__factory,
  TermRepoLocker,
  TermRepoLocker__factory,
  TermRepoRolloverManager,
  TermRepoRolloverManager__factory,
  TermRepoServicer,
  TermRepoServicer__factory,
  TermRepoToken,
  TermRepoToken__factory,
} from "../typechain-types";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";

describe("TermInitializer Tests", () => {
  let deployer: SignerWithAddress;
  let devopsWallet: SignerWithAddress;
  let initializerApprovalWallet: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let wallet1: SignerWithAddress;
  let diamond: SignerWithAddress;

  // Mock controllers
  let mockControllerAllTrue: MockContract<ITermController>; // isTermDeployed→true wildcard, pairAuction wildcard
  let mockControllerDefault: MockContract<ITermController>; // no isTermDeployed stub → returns false
  let mockControllerAllTrueAddr: string;
  let mockControllerDefaultAddr: string;

  // Mock emitter and concrete contracts
  let mockEmitter: MockContract<ITermEventEmitter>;
  let mockLocker: MockContract<TermRepoLocker>;
  let mockToken: MockContract<TermRepoToken>;
  let mockBidLocker: MockContract<TermAuctionBidLocker>;
  let mockOfferLocker: MockContract<TermAuctionOfferLocker>;
  let mockAuction: MockContract<TermAuction>;
  let mockServicer: MockContract<TermRepoServicer>;
  let mockCollateralManager: MockContract<TermRepoCollateralManager>;
  let mockRolloverManager: MockContract<TermRepoRolloverManager>;

  let mockEmitterAddr: string;
  let mockLockerAddr: string;
  let mockTokenAddr: string;
  let mockBidLockerAddr: string;
  let mockOfferLockerAddr: string;
  let mockAuctionAddr: string;
  let mockServicerAddr: string;
  let mockCollateralManagerAddr: string;
  let mockRolloverManagerAddr: string;

  let oracleAddr: string;

  let initializer: TermInitializer;
  let snapshotId: any;

  const DEPLOYER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPLOYER_ROLE"));
  const INITIALIZER_APPROVAL_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("INITIALIZER_APPROVAL_ROLE"),
  );
  const DEVOPS_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEVOPS_ROLE"));

  before(async () => {
    [deployer, devopsWallet, initializerApprovalWallet, adminWallet, wallet1, diamond] =
      await ethers.getSigners();

    // oracle address – only passed to mock pairTermContracts, never called
    oracleAddr = wallet1.address;

    const controllerIface = ITermController__factory.createInterface();
    const emitterIface = ITermEventEmitter__factory.createInterface();

    // ── mockControllerAllTrue: isTermDeployed→true, pairAuction→no-op ─────────
    mockControllerAllTrue = await deployMock<ITermController>(
      ITermController__factory.abi,
      deployer,
    );
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("isTermDeployed"),
      kind: "read",
      inputs: undefined,
      outputs: [true],
    });
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("pairAuction"),
      kind: "write",
      inputs: undefined,
    });
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("registeredRepoIds"),
      kind: "read",
      inputs: undefined,
      outputs: [false],
    });
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("registeredAuctionIds"),
      kind: "read",
      inputs: undefined,
      outputs: [false],
    });
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("registerRepoId"),
      kind: "write",
      inputs: undefined,
    });
    await mockControllerAllTrue.setup({
      abi: controllerIface.getFunction("registerAuctionId"),
      kind: "write",
      inputs: undefined,
    });
    mockControllerAllTrueAddr = await mockControllerAllTrue.getAddress();

    // ── mockControllerDefault: isTermDeployed→false wildcard ─────────────────
    mockControllerDefault = await deployMock<ITermController>(
      ITermController__factory.abi,
      deployer,
    );
    await mockControllerDefault.setup({
      abi: controllerIface.getFunction("isTermDeployed"),
      kind: "read",
      inputs: undefined,
      outputs: [false],
    });
    mockControllerDefaultAddr = await mockControllerDefault.getAddress();

    // ── mockEmitter ───────────────────────────────────────────────────────────
    mockEmitter = await deployMock<ITermEventEmitter>(
      ITermEventEmitter__factory.abi,
      deployer,
    );
    await mockEmitter.setup({
      abi: emitterIface.getFunction("pairTermContract"),
      kind: "write",
      inputs: undefined,
    });
    mockEmitterAddr = await mockEmitter.getAddress();

    // ── Concrete contract mocks with wildcard pairTermContracts stubs ─────────
    mockLocker = await deployMock<TermRepoLocker>(
      TermRepoLocker__factory.abi,
      deployer,
    );
    await mockLocker.setup({
      abi: TermRepoLocker__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockLockerAddr = await mockLocker.getAddress();

    mockToken = await deployMock<TermRepoToken>(
      TermRepoToken__factory.abi,
      deployer,
    );
    await mockToken.setup({
      abi: TermRepoToken__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockTokenAddr = await mockToken.getAddress();

    mockBidLocker = await deployMock<TermAuctionBidLocker>(
      TermAuctionBidLocker__factory.abi,
      deployer,
    );
    await mockBidLocker.setup({
      abi: TermAuctionBidLocker__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    await mockBidLocker.setup({
      abi: TermAuctionBidLocker__factory.createInterface().getFunction(
        "termAuctionId",
      ),
      kind: "read",
      inputs: undefined,
      outputs: [ethers.encodeBytes32String("testAuctionId")],
    });
    mockBidLockerAddr = await mockBidLocker.getAddress();

    mockOfferLocker = await deployMock<TermAuctionOfferLocker>(
      TermAuctionOfferLocker__factory.abi,
      deployer,
    );
    await mockOfferLocker.setup({
      abi: TermAuctionOfferLocker__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockOfferLockerAddr = await mockOfferLocker.getAddress();

    mockAuction = await deployMock<TermAuction>(
      TermAuction__factory.abi,
      deployer,
    );
    await mockAuction.setup({
      abi: TermAuction__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockAuctionAddr = await mockAuction.getAddress();

    mockServicer = await deployMock<TermRepoServicer>(
      TermRepoServicer__factory.abi,
      deployer,
    );
    await mockServicer.setup({
      abi: TermRepoServicer__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    await mockServicer.setup({
      abi: TermRepoServicer__factory.createInterface().getFunction(
        "reopenToNewAuction",
      ),
      kind: "write",
      inputs: undefined,
    });
    await mockServicer.setup({
      abi: TermRepoServicer__factory.createInterface().getFunction(
        "termRepoId",
      ),
      kind: "read",
      inputs: undefined,
      outputs: [ethers.encodeBytes32String("testRepoId")],
    });
    mockServicerAddr = await mockServicer.getAddress();

    mockCollateralManager = await deployMock<TermRepoCollateralManager>(
      TermRepoCollateralManager__factory.abi,
      deployer,
    );
    await mockCollateralManager.setup({
      abi: TermRepoCollateralManager__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    await mockCollateralManager.setup({
      abi: TermRepoCollateralManager__factory.createInterface().getFunction(
        "reopenToNewAuction",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockCollateralManagerAddr = await mockCollateralManager.getAddress();

    mockRolloverManager = await deployMock<TermRepoRolloverManager>(
      TermRepoRolloverManager__factory.abi,
      deployer,
    );
    await mockRolloverManager.setup({
      abi: TermRepoRolloverManager__factory.createInterface().getFunction(
        "pairTermContracts",
      ),
      kind: "write",
      inputs: undefined,
    });
    mockRolloverManagerAddr = await mockRolloverManager.getAddress();
  });

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);

    const InitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    initializer = (await InitializerFactory.connect(deployer).deploy(
      initializerApprovalWallet.address,
      devopsWallet.address,
    )) as unknown as TermInitializer;
    await initializer.waitForDeployment();
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Returns a fully populated TermContractGroup with valid mock addresses */
  function makeGroup(overrides: Record<string, string> = {}): any {
    return {
      termRepoLocker: mockLockerAddr,
      termRepoServicer: mockServicerAddr,
      termRepoCollateralManager: mockCollateralManagerAddr,
      rolloverManager: mockRolloverManagerAddr,
      termRepoToken: mockTokenAddr,
      termAuctionOfferLocker: mockOfferLockerAddr,
      termAuctionBidLocker: mockBidLockerAddr,
      auction: mockAuctionAddr,
      ...overrides,
    };
  }

  /** Stubs isTermDeployed(addr)=true on mockControllerDefault for the given addresses */
  async function stubTermDeployed(...addrs: string[]): Promise<void> {
    const iface = ITermController__factory.createInterface();
    for (const addr of addrs) {
      await mockControllerDefault.setup({
        abi: iface.getFunction("isTermDeployed"),
        kind: "read",
        inputs: [addr] as any,
        outputs: [true],
      });
    }
  }

  // ============================================================================
  // = Constructor ==============================================================
  // ============================================================================

  describe("Constructor", () => {
    it("deployer receives DEPLOYER_ROLE", async () => {
      expect(await initializer.hasRole(DEPLOYER_ROLE, deployer.address)).to.be
        .true;
    });

    it("initializerApprovalWallet receives INITIALIZER_APPROVAL_ROLE", async () => {
      expect(
        await initializer.hasRole(
          INITIALIZER_APPROVAL_ROLE,
          initializerApprovalWallet.address,
        ),
      ).to.be.true;
    });

    it("devopsWallet receives DEVOPS_ROLE", async () => {
      expect(await initializer.hasRole(DEVOPS_ROLE, devopsWallet.address)).to
        .be.true;
    });
  });

  // ============================================================================
  // = pairTermContracts ========================================================
  // ============================================================================

  describe("pairTermContracts", () => {
    it("reverts without DEPLOYER_ROLE", async () => {
      await expect(
        initializer
          .connect(adminWallet)
          .pairTermContracts(
            mockControllerAllTrueAddr as any,
            mockEmitterAddr as any,
            oracleAddr as any,
            diamond.address
          ),
      ).to.be.revertedWithCustomError(
        initializer,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("succeeds and stores controller/emitter/oracle", async () => {
      await expect(
        initializer
          .connect(deployer)
          .pairTermContracts(
            mockControllerAllTrueAddr as any,
            mockEmitterAddr as any,
            oracleAddr as any,
            diamond.address
          ),
      ).to.not.be.reverted;
    });
  });

  // ============================================================================
  // = pauseDeploying / unpauseDeploying ========================================
  // ============================================================================

  describe("pauseDeploying", () => {
    it("reverts without DEVOPS_ROLE", async () => {
      await expect(
        initializer.connect(adminWallet).pauseDeploying(),
      ).to.be.revertedWithCustomError(
        initializer,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("sets deployingPaused=true (verified by DeployingPaused revert on setupTerm)", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address

        );
      await initializer.connect(devopsWallet).pauseDeploying();
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWithCustomError(initializer, "DeployingPaused");
    });
  });

  describe("unpauseDeploying", () => {
    it("reverts without DEVOPS_ROLE", async () => {
      await expect(
        initializer.connect(adminWallet).unpauseDeploying(),
      ).to.be.revertedWithCustomError(
        initializer,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("sets deployingPaused=false (verified by proceeding past pause check)", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await initializer.connect(devopsWallet).pauseDeploying();
      await initializer.connect(devopsWallet).unpauseDeploying();
      // Now deploying is unpaused; setupTerm proceeds past the pause check
      // and fails at the first isTermDeployed check (mockControllerDefault → false)
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRS");
    });
  });

  // ============================================================================
  // = setupTerm ================================================================
  // ============================================================================

  describe("setupTerm", () => {
    it("reverts without INITIALIZER_APPROVAL_ROLE", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address

        );
      await expect(
        initializer
          .connect(deployer)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWithCustomError(
        initializer,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts DeployingPaused", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address

        );
      await initializer.connect(devopsWallet).pauseDeploying();
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWithCustomError(initializer, "DeployingPaused");
    });

    it("reverts Zero address deployer wallet", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address

        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            ethers.ZeroAddress,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero address deployer wallet");
    });

    // isTermDeployed check 1: servicer
    it("reverts Non-Term TRS when servicer not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRS");
    });

    // isTermDeployed check 2: collateralManager
    it("reverts Non-Term TRCM when collateralManager not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(mockServicerAddr);
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRCM");
    });

    // isTermDeployed check 3: locker
    it("reverts Non-Term TRL when locker not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(mockServicerAddr, mockCollateralManagerAddr);
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRL");
    });

    // isTermDeployed check 4: token
    it("reverts Non-Term TRT when token not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockLockerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRT");
    });

    // isTermDeployed check 5: rolloverManager
    it("reverts Non-Term TRM when rolloverManager not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockLockerAddr,
        mockTokenAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRM");
    });

    // isTermDeployed check 6: bidLocker
    it("reverts Non-Term TABL when bidLocker not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockLockerAddr,
        mockTokenAddr,
        mockRolloverManagerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TABL");
    });

    // isTermDeployed check 7: offerLocker
    it("reverts Non-Term TAOL when offerLocker not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockLockerAddr,
        mockTokenAddr,
        mockRolloverManagerAddr,
        mockBidLockerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TAOL");
    });

    // isTermDeployed check 8: auction
    it("reverts Non-Term TA when auction not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockLockerAddr,
        mockTokenAddr,
        mockRolloverManagerAddr,
        mockBidLockerAddr,
        mockOfferLockerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TA");
    });

    // Zero address checks (all isTermDeployed pass via mockControllerAllTrue wildcard)

    it("reverts Zero Address Servicer", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termRepoServicer: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address Servicer");
    });

    it("reverts Zero Address Collateral Manager", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address

        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termRepoCollateralManager: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address Collateral Manager");
    });

    it("reverts Zero Address Locker", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termRepoLocker: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address Locker");
    });

    it("reverts Zero Address RepoToken", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termRepoToken: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address RepoToken");
    });

    it("reverts Zero Address RolloverManager", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ rolloverManager: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address RolloverManager");
    });

    it("reverts Zero Address termAuctionBidLocker", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termAuctionBidLocker: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address termAuctionBidLocker");
    });

    it("reverts Zero Address termAuctionOfferLocker", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ termAuctionOfferLocker: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address termAuctionOfferLocker");
    });

    it("reverts Zero Address auction", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup({ auction: ethers.ZeroAddress }),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.be.revertedWith("Zero Address auction");
    });

    it("success — pairs all contracts", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupTerm(
            makeGroup(),
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
            "v1",
          ),
      ).to.not.be.reverted;
    });
  });

  // ============================================================================
  // = setupAuction =============================================================
  // ============================================================================

  describe("setupAuction", () => {
    it("reverts without INITIALIZER_APPROVAL_ROLE", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(deployer)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWithCustomError(
        initializer,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("reverts DeployingPaused", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await initializer.connect(devopsWallet).pauseDeploying();
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWithCustomError(initializer, "DeployingPaused");
    });

    it("reverts Zero address deployer wallet", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            ethers.ZeroAddress,
            "v1",
          ),
      ).to.be.revertedWith("Zero address deployer wallet");
    });

    // isTermDeployed check 1: servicer
    it("reverts Non-Term TRS when servicer not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRS");
    });

    // isTermDeployed check 2: collateralManager
    it("reverts Non-Term TRCM when collateralManager not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(mockServicerAddr);
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TRCM");
    });

    // isTermDeployed check 3: bidLocker
    it("reverts Non-Term TABL when bidLocker not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(mockServicerAddr, mockCollateralManagerAddr);
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TABL");
    });

    // isTermDeployed check 4: offerLocker
    it("reverts Non-Term TAOL when offerLocker not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockBidLockerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TAOL");
    });

    // isTermDeployed check 5: auction
    it("reverts Non-Term TA when auction not deployed", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerDefaultAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await stubTermDeployed(
        mockServicerAddr,
        mockCollateralManagerAddr,
        mockBidLockerAddr,
        mockOfferLockerAddr,
      );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Non-Term TA");
    });

    // Zero address checks

    it("reverts Zero Address termAuctionBidLocker", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            ethers.ZeroAddress as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Zero Address termAuctionBidLocker");
    });

    it("reverts Zero Address termAuctionOfferLocker", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            ethers.ZeroAddress as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Zero Address termAuctionOfferLocker");
    });

    it("reverts Zero Address auction", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            ethers.ZeroAddress as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.be.revertedWith("Zero Address auction");
    });

    it("success — pairs auction contracts", async () => {
      await initializer
        .connect(deployer)
        .pairTermContracts(
          mockControllerAllTrueAddr as any,
          mockEmitterAddr as any,
          oracleAddr as any,
          diamond.address
        );
      await expect(
        initializer
          .connect(initializerApprovalWallet)
          .setupAuction(
            mockServicerAddr as any,
            mockCollateralManagerAddr as any,
            mockOfferLockerAddr as any,
            mockBidLockerAddr as any,
            mockAuctionAddr as any,
            adminWallet.address,
            adminWallet.address,
            deployer.address,
            "v1",
          ),
      ).to.not.be.reverted;
    });
  });
});
