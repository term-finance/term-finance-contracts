/* eslint-disable camelcase */
import { ethers, upgrades } from "hardhat";
import { deployMaturityPeriod } from "../utils/deploy-utils";
import {
  ERC20Upgradeable,
  TermController,
  TermEventEmitter,
  TermInitializer,
  TermPriceConsumerV3,
} from "../typechain-types";
import { FakeContract, smock } from "@defi-wonderland/smock";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

dayjs.extend(duration);

describe("deploy-utils", () => {
  let devopsMultisig: SignerWithAddress;
  let deployApprove: SignerWithAddress;
  let adminWallet: SignerWithAddress;
  let treasury: SignerWithAddress;
  let reserve: SignerWithAddress;
  let termController: TermController;
  let termEventEmitter: TermEventEmitter;
  let oracle: TermPriceConsumerV3;
  let termInitializer: TermInitializer;
  let controllerAdmin: SignerWithAddress;
  let evergreenManagementWallet: SignerWithAddress;
  let testCollateralToken: FakeContract<ERC20Upgradeable>;
  let testBorrowedToken: FakeContract<ERC20Upgradeable>;

  beforeEach(async () => {
    upgrades.silenceWarnings();

    [
      ,
      treasury,
      reserve,
      devopsMultisig,
      deployApprove,
      adminWallet,
      controllerAdmin,
      evergreenManagementWallet,
    ] = await ethers.getSigners();

    const termControllerFactory = await ethers.getContractFactory(
      "TermController"
    );
    termController = (await upgrades.deployProxy(
      termControllerFactory,
      [
        treasury.address,
        reserve.address,
        controllerAdmin.address,
        devopsMultisig.address,
        evergreenManagementWallet.address,
      ],
      {
        kind: "uups",
      }
    )) as TermController;

    const termPriceOracleFactory = await ethers.getContractFactory(
      "TermPriceConsumerV3"
    );
    oracle = (await upgrades.deployProxy(
      termPriceOracleFactory,
      [devopsMultisig.address, evergreenManagementWallet.address],
      {
        kind: "uups",
      }
    )) as TermPriceConsumerV3;

    const termInitializerFactory = await ethers.getContractFactory(
      "TermInitializer"
    );
    termInitializer = await termInitializerFactory.deploy(
      deployApprove.address,
      devopsMultisig.address
    );
    await termInitializer.deployed();

    const termEventEmitterFactory = await ethers.getContractFactory(
      "TermEventEmitter"
    );
    termEventEmitter = (await upgrades.deployProxy(
      termEventEmitterFactory,
      [
        devopsMultisig.address,
        evergreenManagementWallet.address,
        termInitializer.address,
      ],
      { kind: "uups" }
    )) as TermEventEmitter;

    testCollateralToken = await smock.fake<ERC20Upgradeable>(
      "ERC20Upgradeable"
    );
    await testCollateralToken.deployed();
    testBorrowedToken = await smock.fake<ERC20Upgradeable>("ERC20Upgradeable");
    await testBorrowedToken.deployed();

    await termInitializer.pairTermContracts(
      termController.address,
      termEventEmitter.address,
      oracle.address
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
        termControllerAddress: termController.address,
        termOracleAddress: oracle.address,
        termEventEmitterAddress: termEventEmitter.address,
        termInitializerAddress: termInitializer.address,
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
        purchaseTokenAddress: testBorrowedToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: deployApprove,
        devopsMultisig: devopsMultisig.address,
        adminWallet: adminWallet.address,
        controllerAdmin,
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",
      },
      "uups"
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
        termControllerAddress: termController.address,
        termOracleAddress: oracle.address,
        termEventEmitterAddress: termEventEmitter.address,
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
        purchaseTokenAddress: testBorrowedToken.address,
        collateralTokenAddresses: [testCollateralToken.address],
        termApprovalMultisig: deployApprove,
        devopsMultisig: devopsMultisig.address,
        adminWallet: adminWallet.address,
        controllerAdmin,
        termVersion: "0.1.0",
        auctionVersion: "0.1.0",
        mintExposureCap: "1000000000000000000",

        termInitializerAddress: termInitializer.address,
      },
      "uups"
    );
  });
});
/* eslint-enable camelcase */
