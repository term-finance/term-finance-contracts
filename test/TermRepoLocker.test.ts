import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { upgrades, ethers } from "hardhat";
import {
  TermEventEmitter,
  TermRepoLocker,
  TestToken,
  TestToken__factory,
} from "../typechain-types";
import {
  deployMockContract,
  MockContract,
} from "@term-finance/ethers-mock-contract/compat/waffle";

/// @note most termRepoLocker tests are in term manager tests, this test file covers an edge case of reverts due to failed erc20 transfers.
describe("TermRepoLocker Tests", () => {
  let termRepoLocker: TermRepoLocker;
  let termRepoCollateralManager: SignerWithAddress;
  let termRepoServicer: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let eventEmitter: TermEventEmitter;
  let devopsMultisig: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let termDiamond: SignerWithAddress;
  let collateralToken: MockContract<TestToken>;

  let wallet1: SignerWithAddress;
  let expectedVersion: string;

  before(async () => {
    upgrades.silenceWarnings();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.waitForDeployment();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");

    [
      termRepoCollateralManager,
      termRepoServicer,
      termInitializer,
      devopsMultisig,
      adminWallet,
      wallet1,
      termDiamond
    ] = await ethers.getSigners();

    eventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet1.address, termInitializer.address, adminWallet.address, termDiamond.address],
      {
        kind: "uups",
      },
    )) as unknown as TermEventEmitter;

    const TermRepoLocker = await ethers.getContractFactory("TermRepoLocker");

    const termIdString = "term";

    termRepoLocker = (await upgrades.deployProxy(
      TermRepoLocker,
      [termIdString, termInitializer.address],
      {
        kind: "uups",
      },
    )) as unknown as TermRepoLocker;

    await eventEmitter
      .connect(termInitializer)
      .pairTermContract(await termRepoLocker.getAddress());

    await termRepoLocker
      .connect(termInitializer)
      .pairTermContracts(
        termRepoCollateralManager.address,
        termRepoServicer.address,
        await eventEmitter.getAddress(),
        devopsMultisig.address,
        adminWallet.address,
      );

    collateralToken = await deployMockContract<TestToken>(
      wallet1,
      TestToken__factory.abi,
    );
  });

  it("erc20 transfers failing reverts termRepoLocker transfers", async () => {
    await collateralToken.mock.transferFrom.returns(false);
    await expect(
      termRepoLocker
        .connect(termRepoCollateralManager)
        .transferTokenFromWallet(
          wallet1.address,
          await collateralToken.getAddress(),
          20,
        ),
    ).to.be.reverted;

    await expect(
      termRepoLocker
        .connect(termRepoCollateralManager)
        .transferTokenToWallet(
          wallet1.address,
          await collateralToken.getAddress(),
          20,
        ),
    ).to.be.reverted;
  });
  it("version returns the current contract version", async () => {
    expect(await termRepoLocker.version()).to.eq(expectedVersion);
  });
});
