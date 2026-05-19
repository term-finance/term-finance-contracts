/* eslint-disable camelcase */
import { ethers, upgrades } from "hardhat";
import { deployMaturityPeriod } from "../utils/deploy-utils";
import {
  ERC20Upgradeable,
  ERC20Upgradeable__factory,
  TermController,
  TermDiamond,
  TermDiamondFactory,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
} from "../typechain-types";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MockContract, deployMock } from "@term-finance/ethers-mock-contract";

dayjs.extend(duration);

describe("deploy-utils", () => {
  let wallet1: SignerWithAddress;
  let devopsMultisig: SignerWithAddress;
  let deployApprove: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let termDiamond: TermDiamond;
  let treasury: SignerWithAddress;
  let reserve: SignerWithAddress;
  let termController: TermController;
  let termEventEmitter: TermEventEmitter;
  let oracle: TermPriceConsumerV3;
  let termInitializer: TermInitializer;
  let controllerAdmin: SignerWithAddress;
  let termDelisterWallet: SignerWithAddress;
  let testCollateralToken: MockContract<ERC20Upgradeable>;
  let testBorrowedToken: MockContract<ERC20Upgradeable>;

  beforeEach(async () => {
    upgrades.silenceWarnings();

    [
      wallet1,
      treasury,
      reserve,
      devopsMultisig,
      deployApprove,
      adminWallet,
      controllerAdmin,
      termDelisterWallet,
    ] = await ethers.getSigners();

    const termControllerFactory =
      await ethers.getContractFactory("TermController");
    termController = (await upgrades.deployProxy(
      termControllerFactory,
      [
        treasury.address,
        reserve.address,
        controllerAdmin.address,
        devopsMultisig.address,
        adminWallet.address,
      ],
      {
        kind: "uups",
      },
    )) as unknown as TermController;

    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3",
    );
    oracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [devopsMultisig.address],
      {
        kind: "uups",
      },
    )) as unknown as TermPriceConsumerV3;

    const termInitializerFactory =
      await ethers.getContractFactory("TermInitializer");
    termInitializer = await termInitializerFactory.deploy(
      deployApprove.address,
      devopsMultisig.address,
    );
    await termInitializer.waitForDeployment();

    // Deploy TermDiamond via factory
    const termDiamondFactoryFactory =
      await ethers.getContractFactory("TermDiamondFactory");
    const termDiamondFactory = (await termDiamondFactoryFactory.deploy(
      adminWallet.address,
      devopsMultisig.address,
    )) as unknown as TermDiamondFactory;
    await termDiamondFactory.waitForDeployment();

    const termDiamondTx = await termDiamondFactory.deployDiamond();
    const termDiamondReceipt = await termDiamondTx.wait();
    const diamondDeployedEvent = termDiamondReceipt?.logs.find(
      (log) =>
        log.topics[0] ===
        termDiamondFactory.interface.getEvent("DiamondDeployed").topicHash,
    );
    if (!diamondDeployedEvent)
      throw new Error("DiamondDeployed event not found");
    const decodedEvent =
      termDiamondFactory.interface.parseLog(diamondDeployedEvent);
    termDiamond = (await ethers.getContractAt(
      "TermDiamond",
      decodedEvent!.args.diamond,
    )) as unknown as TermDiamond;

    const termEventEmitterFactory =
      await ethers.getContractFactory("TermEventEmitter");
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        devopsMultisig.address,
        termDelisterWallet.address,
        await termInitializer.getAddress(),
        adminWallet.address,
        await termDiamond.getAddress(),
      ],
      { kind: "uups" },
    )) as unknown as TermEventEmitter;

    testCollateralToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );
    testBorrowedToken = await deployMock<ERC20Upgradeable>(
      ERC20Upgradeable__factory.abi,
      wallet1,
    );

    const erc20Interface = ERC20Upgradeable__factory.createInterface();
    await testCollateralToken.setup({
      abi: erc20Interface.getFunction("decimals"),
      inputs: [],
      outputs: [18],
      kind: "read",
    });
    await testBorrowedToken.setup({
      abi: erc20Interface.getFunction("decimals"),
      inputs: [],
      outputs: [18],
      kind: "read",
    });

    await termController
      .connect(adminWallet)
      .pairInitializer(await termInitializer.getAddress());

    await termInitializer.pairTermContracts(
      await termController.getAddress(),
      await termEventEmitter.getAddress(),
      await oracle.getAddress(),
      await termDiamond.getAddress(),
    );
  });

  it("deployMaturityPeriod deploys all contracts properly - uups", async () => {
    const auctionStart = dayjs().add(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const defaultRolloverBuffer = dayjs.duration(1, "hours");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");
    const servicerMaturity = maturity.subtract(defaultRolloverBuffer);

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termOracleAddress: await oracle.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        termDiamondAddress: await termDiamond.getAddress(),
        termInitializerAddress: await termInitializer.getAddress(),
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        servicerMaturityTimestamp: servicerMaturity.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asSeconds().toString(),
        redemptionBuffer: redemptionBuffer.asSeconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: await testBorrowedToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: deployApprove,
        devopsMultisig: devopsMultisig.address,
        adminWallet: adminWallet.address,
        controllerAdmin,
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );
  });
  /*
  it("deployMaturityPeriod deploys all contracts properly - raw", async () => {
    const auctionStart = dayjs().add(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termOracleAddress: oracle.address,
        termEventEmitterAddress: termEventEmitter.address,
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asMilliseconds().toString(),
        redemptionBuffer: redemptionBuffer.asMilliseconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: testBorrowedToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        mintExposureCap: "1000000000000000000",
      },
      "raw"
    );
  });

  it("deployMaturityPeriod deploys all contracts properly using TermInitializer - raw", async () => {
    const auctionStart = dayjs().add(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    await deployMaturityPeriod(
      {
        termControllerAddress: termController.address,
        termOracleAddress: oracle.address,
        termEventEmitterAddress: termEventEmitter.address,
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asMilliseconds().toString(),
        redemptionBuffer: redemptionBuffer.asMilliseconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: testBorrowedToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        mintExposureCap: "1000000000000000000",

        termInitializerAddress: termInitializer.address,
      },
      "raw"
    );
  });
*/
  it("deployMaturityPeriod deploys all contracts properly using TermInitializer - uups", async () => {
    const auctionStart = dayjs().add(1, "minute");

    const defaultAuctionDuration = dayjs.duration(1, "day");
    const defaultRevealDuration = dayjs.duration(10, "minutes");
    const defaultTermLength = dayjs.duration(1, "month");
    const defaultRolloverBuffer = dayjs.duration(1, "hours");
    const auctionReveal = auctionStart.add(defaultAuctionDuration);
    const auctionEnd = auctionReveal.add(defaultRevealDuration);
    const maturity = auctionEnd.add(defaultTermLength);
    const servicerMaturity = maturity.subtract(defaultRolloverBuffer);
    const repurchaseWindow = dayjs.duration(1, "day");
    const redemptionBuffer = dayjs.duration(5, "minutes");

    const minimumTenderAmount = "10";

    const liquidateDamangesDueToProtocol = "3" + "0".repeat(16); //   3%
    const servicingFee = "3" + "0".repeat(15); //   0.3%
    const maintenanceRatio = "125" + "0".repeat(16); // 125%
    const initialCollateralRatio = "15" + "0".repeat(17); // 150%
    const liquidatedDamage = "5" + "0".repeat(16); //   5%
    const netExposureCapOnLiquidation = "5" + "0".repeat(16); //   5%
    const deMinimisMarginThreshold = "50" + "0".repeat(18);

    await deployMaturityPeriod(
      {
        termControllerAddress: await termController.getAddress(),
        termOracleAddress: await oracle.getAddress(),
        termEventEmitterAddress: await termEventEmitter.getAddress(),
        auctionStartDate: auctionStart.unix().toString(),
        auctionRevealDate: auctionReveal.unix().toString(),
        auctionEndDate: auctionEnd.unix().toString(),
        maturityTimestamp: maturity.unix().toString(),
        servicerMaturityTimestamp: servicerMaturity.unix().toString(),
        minimumTenderAmount,
        repurchaseWindow: repurchaseWindow.asMilliseconds().toString(),
        redemptionBuffer: redemptionBuffer.asMilliseconds().toString(),
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        liquidateDamangesDueToProtocol,
        servicingFee,
        maintenanceCollateralRatios: [maintenanceRatio],
        initialCollateralRatios: [initialCollateralRatio],
        liquidatedDamages: [liquidatedDamage],
        purchaseTokenAddress: await testBorrowedToken.getAddress(),
        collateralTokenAddresses: [await testCollateralToken.getAddress()],
        termApprovalMultisig: deployApprove,
        devopsMultisig: devopsMultisig.address,
        adminWallet: adminWallet.address,
        controllerAdmin,
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",

        termInitializerAddress: await termInitializer.getAddress(),
        clearingPricePostProcessingOffset: "0",
      },
      "uups",
    );
  });
});
/* eslint-enable camelcase */
