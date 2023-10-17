import { FakeContract, smock } from "@defi-wonderland/smock";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { upgrades, ethers } from "hardhat";
import {
  TermEventEmitter,
  TermRepoLocker,
  TestToken,
} from "../typechain-types";

/// @note most termRepoLocker tests are in term manager tests, this test file covers an edge case of reverts due to failed erc20 transfers.
describe("TermRepoLocker Tests", () => {
  let termRepoLocker: TermRepoLocker;
  let termRepoCollateralManager: SignerWithAddress;
  let termRepoServicer: SignerWithAddress;
  let termInitializer: SignerWithAddress;
  let eventEmitter: TermEventEmitter;
  let devopsMultisig: SignerWithAddress;
  let collateralToken: FakeContract<TestToken>;

  let wallet1: SignerWithAddress;
  let expectedVersion: string;

  before(async () => {
    upgrades.silenceWarnings();

    const versionableFactory = await ethers.getContractFactory("Versionable");
    const versionable = await versionableFactory.deploy();
    await versionable.deployed();
    expectedVersion = await versionable.version();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );

    [
      termRepoCollateralManager,
      termRepoServicer,
      termInitializer,
      devopsMultisig,
      wallet1,
    ] = await ethers.getSigners();

    eventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [devopsMultisig.address, wallet1.address, termInitializer.address],
      {
        kind: "uups",
      }
    )) as TermEventEmitter;

    const TermRepoLocker = await ethers.getContractFactory("TermRepoLocker");

    const termIdString = "term";

    termRepoLocker = (await upgrades.deployProxy(
      TermRepoLocker,
      [termIdString, termInitializer.address],
      {
        kind: "uups",
      }
    )) as TermRepoLocker;

    await eventEmitter
      .connect(termInitializer)
      .pairTermContract(termRepoLocker.address);

    await termRepoLocker
      .connect(termInitializer)
      .pairTermContracts(
        termRepoCollateralManager.address,
        termRepoServicer.address,
        eventEmitter.address,
        devopsMultisig.address
      );

    collateralToken = await smock.fake<TestToken>("TestToken");
  });

  it("erc20 transfers failing reverts termRepoLocker transfers", async () => {
    collateralToken.transferFrom.returns(false);
    await expect(
      termRepoLocker
        .connect(termRepoCollateralManager)
        .transferTokenFromWallet(wallet1.address, collateralToken.address, 20)
    ).to.be.reverted;

    await expect(
      termRepoLocker
        .connect(termRepoCollateralManager)
        .transferTokenToWallet(wallet1.address, collateralToken.address, 20)
    ).to.be.reverted;
  });
  it("version returns the current contract version", async () => {
    expect(await termRepoLocker.version()).to.eq(expectedVersion);
  });
});
