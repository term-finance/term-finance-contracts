/* eslint-disable camelcase */
import { BigNumber, Contract, ContractFactory, Signer } from "ethers";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import { commify, formatUnits } from "ethers/lib/utils";
import hre, { ethers, upgrades } from "hardhat";
import { FactoryOptions, Libraries } from "hardhat/types";
import {
  IERC20MetadataUpgradeable,
  MultiSend,
  TermAuction,
  TermAuctionBidLocker,
  TermAuctionOfferLocker,
  TermRepoCollateralManager,
  TermController,
  TermRepoServicer,
  TermRepoLocker,
  TermPriceConsumerV3,
  TermRepoToken,
  TermRepoRolloverManager,
  TermEventEmitter,
  TermInitializer,
  TermInitializer__factory,
} from "../typechain-types";
import { NonceManager } from "@ethersproject/experimental";
import { GelatoOpsSDK } from "@gelatonetwork/ops-sdk";
import { v4 } from "uuid";
import TermControllerABI from "../abi/TermController.json";
import TermEventEmitterABI from "../abi/TermEventEmitter.json";
import IERC20MetadataUpgradeableABI from "../abi/IERC20MetadataUpgradeable.json";
import TermPriceConsumerV3ABI from "../abi/TermPriceConsumerV3.json";
import TermInitializerABI from "../abi/TermInitializer.json";
import { CollateralStruct } from "../typechain-types/contracts/TermRepoCollateralManager";
import { existsSync, readFileSync, writeFileSync } from "fs";
import dayjs from "dayjs";
import { deployContractUUPSProxyBeacon } from "./deploy-proxies-for-impl";

export type MaturityPeriodInfo = {
  termRepoId: string;
  termAuctionId: string;
  controller: TermController;
  eventEmitter: TermEventEmitter;
  oracle: TermPriceConsumerV3;

  termRepoServicer: TermRepoServicer;
  termRepoCollateralManager: TermRepoCollateralManager;
  termRepoToken: TermRepoToken;
  termRepoLocker: TermRepoLocker;
  termAuctionBidLocker: TermAuctionBidLocker;
  termAuctionOfferLocker: TermAuctionOfferLocker;
  auction: TermAuction;
  rolloverManager: TermRepoRolloverManager;
};

export type AdditionalAuctionInfo = {
  termRepoId: string;
  termAuctionId: string;
  controller?: TermController;

  oracle: TermPriceConsumerV3;
  termRepoServicer: TermRepoServicer;
  termRepoCollateralManager: TermRepoCollateralManager;
  termAuctionBidLocker: TermAuctionBidLocker;
  termAuctionOfferLocker: TermAuctionOfferLocker;
  auction: TermAuction;
};

function logGasCost(receipt: TransactionReceipt) {
  const gasUsed = BigNumber.from(receipt.gasUsed);
  const gasPrice = BigNumber.from(receipt.effectiveGasPrice);
  const gasCost = gasUsed.mul(gasPrice);
  console.log(`Gas used: ${gasUsed.toString()}`);
  console.log(`Gas price: ${commify(formatUnits(gasPrice, 9))} GWEI`);
  console.log(`Gas cost: ${commify(formatUnits(gasCost))} ETH`);
}

async function retry<T>(
  fn: () => Promise<T>,
  retriesLeft = 10,
  interval = 30000,
) {
  try {
    return await fn();
  } catch (error) {
    if (retriesLeft === 1) {
      throw error;
    }
    console.warn(`Retrying in ${interval / 1000} seconds...`);
    return await new Promise<T>((resolve) => {
      setTimeout(
        () => retry(fn, retriesLeft - 1, interval).then(resolve),
        interval,
      );
    });
  }
}

function getContractFactory(
  name: string,
  signer?: Signer,
  libraries?: Libraries,
): Promise<ContractFactory> {
  const contractFactoryOptions: FactoryOptions = {};
  if (libraries) {
    contractFactoryOptions.libraries = libraries;
  }
  if (signer) {
    contractFactoryOptions.signer = signer;
  }
  return ethers.getContractFactory(name, contractFactoryOptions);
}

export async function deployLibrary(
  name: string,
  signer: Signer | undefined = undefined,
) {
  const contractFactory = await ethers.getContractFactory(name, signer);
  const deployedLibrary = await contractFactory.deploy();
  await deployedLibrary.deployed();
  console.log(`${name} deployed to: ${deployedLibrary.address}`);
  return deployedLibrary;
}

export async function deployContract<T extends Contract = Contract>(
  name: string,
  args: Parameters<T["initialize"]> = [] as unknown as Parameters<
    T["initialize"]
  >,
  kind: "uups" | "transparent" | "raw" = "uups",
  signer: Signer | undefined = undefined,
  libraries: Libraries | undefined = undefined,
  skipInitialize = false,
) {
  console.log(`Deploying ${name} with kind ${kind}...`);

  const contractFactory = await getContractFactory(name, signer, libraries);

  if (kind === "raw") {
    const deployedContract = await contractFactory.deploy(args);
    await deployedContract.deployed();
    if (!skipInitialize) {
      await deployedContract.initialize(...args);
      console.log(`${name} deployed to: ${deployedContract.address}`);
    }
    return deployedContract as T;
  }

  const deployedContract =
    libraries === undefined
      ? await upgrades.deployProxy(contractFactory, args, {
          kind,
          timeout: 0,
        })
      : await upgrades.deployProxy(contractFactory, args, {
          kind,
          unsafeAllowLinkedLibraries: true,
          timeout: 0,
        });
  console.log(
    `${name} deployment txn: ${deployedContract.deployTransaction.hash}`,
  );
  await deployedContract.deployed();
  console.log(`${name} deployed to: ${deployedContract.address}`);
  return deployedContract as T;
}

export async function upgradeContract<T extends Contract = Contract>(
  name: string,
  address: string,
  kind: "uups" | "transparent" = "uups",
  signer: Signer | undefined = undefined,
  libraries: Libraries | undefined = undefined,
) {
  const contractFactory = await getContractFactory(name, signer, libraries);

  const upgradedContract =
    libraries === undefined
      ? await upgrades.upgradeProxy(address, contractFactory, {
          kind,
        })
      : await upgrades.upgradeProxy(address, contractFactory, {
          kind,
          unsafeAllowLinkedLibraries: true,
        });
  console.log(`${name} deployed to: ${upgradedContract.address}`);
  return upgradedContract as T;
}

export async function scheduleCompleteAuctionTask(
  gelatoOps: GelatoOpsSDK,
  auction: Contract,
  cid: string,
) {
  // Create task using ops-sdk
  console.log("Creating automate task...");
  const { taskId, tx } = await gelatoOps.createTask({
    name: `TermFinance - Complete Auction ${auction.address}`,
    execAddress: auction.address,
    execSelector: auction.getSighash("completeAuction"),
    dedicatedMsgSender: false,
    web3FunctionHash: cid,
    web3FunctionArgs: {
      auction: auction.address,
    },
  });
  await tx.wait();
  console.log(`Task created, taskId: ${taskId} (tx hash: ${tx.hash})`);
  console.log(
    `> https://beta.app.gelato.network/task/${taskId}?chainId=${tx.chainId}`,
  );
}

export async function scheduleBatchProcessRolloversTask(
  gelatoOps: GelatoOpsSDK,
  rolloverManager: Contract,
  cid: string,
) {
  // Create task using ops-sdk
  console.log("Creating automate task...");
  const { taskId, tx } = await gelatoOps.createTask({
    name: `TermFinance - Batch Process Rollovers ${rolloverManager.address}`,
    execAddress: rolloverManager.address,
    execSelector: rolloverManager.getSighash("batchProcessRollovers"),
    dedicatedMsgSender: false,
    web3FunctionHash: cid,
    web3FunctionArgs: {
      rolloverManagerAddress: rolloverManager.address,
    },
  });
  await tx.wait();
  console.log(`Task created, taskId: ${taskId} (tx hash: ${tx.hash})`);
  console.log(
    `> https://beta.app.gelato.network/task/${taskId}?chainId=${tx.chainId}`,
  );
}

export async function deployController(
  treasuryAddress: string,
  protocolReserveAddress: string,
  adminWallet: string,
  devopsWallet: string,
  evergreenManagementWallet: string,
  kind: "uups" | "transparent" | "raw" = "uups",
  signer: Signer | undefined = undefined,
): Promise<TermController> {
  const termControllerContract = await deployContract<TermController>(
    "TermController",
    [treasuryAddress, protocolReserveAddress, adminWallet, devopsWallet],
    kind,
    signer,
  );
  return termControllerContract;
}

export async function deployEventEmitter(
  devopsWallet: string,
  termDelister: string,
  termInitializer: string,
  kind: "uups" | "transparent" | "raw" = "uups",
  signer: Signer | undefined = undefined,
): Promise<TermEventEmitter> {
  const termEventEmitterContract = await deployContract<TermEventEmitter>(
    "TermEventEmitter",
    [devopsWallet, termDelister, termInitializer],
    kind,
    signer,
  );
  return termEventEmitterContract;
}

export async function deployPriceOracle(
  devopsWallet: string,
  evergreenManagementWallet: string,
  kind: "uups" | "transparent" | "raw" = "uups",
  signer: Signer | undefined = undefined,
): Promise<TermPriceConsumerV3> {
  const termPriceConsumer = await deployContract<TermPriceConsumerV3>(
    "TermPriceConsumerV3",
    [devopsWallet],
    kind,
    signer,
  );
  return termPriceConsumer;
}

export async function deployInitializer(
  termApprovalWallet: string,
  devopsWallet: string,
  signer: Signer | undefined = undefined,
): Promise<TermInitializer> {
  const contractFactory = (await getContractFactory(
    "TermInitializer",
    signer,
    undefined,
  )) as TermInitializer__factory;

  const termInitializer = await contractFactory.deploy(
    termApprovalWallet,
    devopsWallet,
  );
  return termInitializer;
}

export async function deployMultiSend(
  signer: Signer | undefined = undefined,
): Promise<MultiSend> {
  const multisendFactory = await ethers.getContractFactory("MultiSend", signer);
  const multiSend = await multisendFactory.deploy();
  logGasCost(await multiSend.deployTransaction.wait());
  return await multiSend.deployed();
}

export async function whitelistContract(
  termController: TermController,
  termAddress: string,
) {
  await termController.markTermDeployed(termAddress);
}

export async function whitelistContractForEventEmitter(
  eventEmitter: TermEventEmitter,
  termAddress: string,
) {
  await eventEmitter.pairTermContract(termAddress);
}

export async function deployTermContract<T extends Contract>(
  name: string,
  args: Parameters<T["initialize"]> = [] as unknown as Parameters<
    T["initialize"]
  >,
  kind: "uups" | "transparent" | "raw" = "uups",
  termController: TermController,
  termEventEmitter: TermEventEmitter,
  signer: Signer | undefined = undefined,
  libraries: Libraries | undefined = undefined,
) {
  const termContract = await deployContract(
    name,
    args,
    kind,
    signer,
    libraries,
  );

  // TODO: Security issue if left whitelisted and deploy fails?
  await whitelistContract(termController, termContract.address);

  return termContract as T;
}

export async function deployMaturityPeriod(
  {
    termControllerAddress,
    termOracleAddress,
    termEventEmitterAddress,
    termInitializerAddress,
    auctionStartDate,
    auctionRevealDate,
    auctionEndDate,
    maturityTimestamp,
    servicerMaturityTimestamp,
    minimumTenderAmount,
    repurchaseWindow,
    redemptionBuffer,
    netExposureCapOnLiquidation,
    deMinimisMarginThreshold,
    liquidateDamangesDueToProtocol,
    servicingFee,
    purchaseTokenAddress,
    collateralTokenAddresses,
    initialCollateralRatios,
    maintenanceCollateralRatios,
    liquidatedDamages,
    mintExposureCap,
    termRepoServicerAddress,
    collateralManagerAddress,
    termRepoTokenAddress,
    repoLockerAddress,
    bidLockerAddress,
    offerLockerAddress,
    auctionAddress,
    rolloverManagerAddress,
    termRepoServicerImplAddress,
    collateralManagerImplAddress,
    termRepoTokenImplAddress,
    repoLockerImplAddress,
    bidLockerImplAddress,
    offerLockerImplAddress,
    auctionImplAddress,
    rolloverManagerImplAddress,
    termId,
    auctionId,
    termApprovalMultisig,
    devopsMultisig,
    adminWallet,
    controllerAdmin,
    termVersion,
    auctionVersion,

    clearingPricePostProcessingOffset = "1",

    termRepoServicerContractName = "TermRepoServicer",
    termRepoCollateralManagerContractName = "TermRepoCollateralManager",
    termRepoTokenContractName = "TermRepoToken",
    termRepoLockerContractName = "TermRepoLocker",
    termAuctionBidLockerContractName = "TermAuctionBidLocker",
    termAuctionOfferLockerContractName = "TermAuctionOfferLocker",
    auctionContractName = "TermAuction",
    rolloverManagerContractName = "TermRepoRolloverManager",

    pairTermContractsThruGnosis = false,
    scheduleGelatoOps,
  }: {
    termControllerAddress: string;
    termOracleAddress: string;
    termEventEmitterAddress: string;
    termInitializerAddress?: string;
    auctionStartDate: string;
    auctionRevealDate: string;
    auctionEndDate: string;
    maturityTimestamp: string;
    servicerMaturityTimestamp: string;
    minimumTenderAmount: string;
    repurchaseWindow: string;
    redemptionBuffer: string;
    netExposureCapOnLiquidation: string;
    deMinimisMarginThreshold: string;
    liquidateDamangesDueToProtocol: string;
    servicingFee: string;
    purchaseTokenAddress: string;
    collateralTokenAddresses: string[];
    initialCollateralRatios: string[];
    maintenanceCollateralRatios: string[];
    liquidatedDamages: string[];
    mintExposureCap: string;
    termRepoServicerAddress?: string;
    collateralManagerAddress?: string;
    termRepoTokenAddress?: string;
    repoLockerAddress?: string;
    bidLockerAddress?: string;
    offerLockerAddress?: string;
    auctionAddress?: string;
    rolloverManagerAddress?: string;
    termRepoServicerImplAddress?: string;
    collateralManagerImplAddress?: string;
    termRepoTokenImplAddress?: string;
    repoLockerImplAddress?: string;
    bidLockerImplAddress?: string;
    offerLockerImplAddress?: string;
    auctionImplAddress?: string;
    rolloverManagerImplAddress?: string;
    termId?: string;
    auctionId?: string;
    termApprovalMultisig: Signer;
    devopsMultisig: string;
    adminWallet: string;
    controllerAdmin: Signer;
    termVersion: string;
    auctionVersion: string;

    clearingPricePostProcessingOffset: string;

    termRepoServicerContractName?: string;
    termRepoCollateralManagerContractName?: string;
    termRepoTokenContractName?: string;
    termRepoLockerContractName?: string;
    termAuctionBidLockerContractName?: string;
    termAuctionOfferLockerContractName?: string;
    auctionContractName?: string;
    rolloverManagerContractName?: string;

    pairTermContractsThruGnosis?: boolean;
    scheduleGelatoOps?: boolean;
  },
  kind: "uups" | "transparent" | "raw" = "uups",
): Promise<MaturityPeriodInfo> {
  const [defaultSigner] = await ethers.getSigners();
  const managedSigner = new NonceManager(defaultSigner as any);
  let gelatoOps: GelatoOpsSDK | undefined;

  const termRepoId = termId || v4();
  const termAuctionId = auctionId || v4();

  const termController = (await ethers.getContractAt(
    TermControllerABI,
    termControllerAddress,
    controllerAdmin,
  )) as TermController;

  const eventEmitter = (await ethers.getContractAt(
    TermEventEmitterABI,
    termEventEmitterAddress,
    managedSigner,
  )) as TermEventEmitter;
  const oracle: TermPriceConsumerV3 = (await ethers.getContractAt(
    TermPriceConsumerV3ABI,
    termOracleAddress,
    managedSigner,
  )) as TermPriceConsumerV3;
  const initializer: TermInitializer | undefined =
    termInitializerAddress && !pairTermContractsThruGnosis
      ? ((await ethers.getContractAt(
          TermInitializerABI,
          termInitializerAddress,
          managedSigner,
        )) as TermInitializer)
      : undefined;
  const initializerForApproval: TermInitializer | undefined =
    termInitializerAddress && !pairTermContractsThruGnosis
      ? ((await ethers.getContractAt(
          TermInitializerABI,
          termInitializerAddress,
          termApprovalMultisig,
        )) as TermInitializer)
      : undefined;
  const purchaseToken = (await ethers.getContractAt(
    IERC20MetadataUpgradeableABI,
    purchaseTokenAddress,
    managedSigner,
  )) as IERC20MetadataUpgradeable;

  const purchaseTokenDecimals = await purchaseToken.decimals();

  const collateralMetadatas: CollateralStruct[] = [];
  for (let i = 0; i < collateralTokenAddresses.length; i++) {
    collateralMetadatas.push({
      tokenAddress: collateralTokenAddresses[i],
      liquidatedDamage: liquidatedDamages[i],
      initialCollateralRatio: initialCollateralRatios[i],
      maintenanceRatio: maintenanceCollateralRatios[i],
    });
  }

  if (!termController.address) {
    throw new Error("Term Controller contract not found");
  }
  console.log(`TermController address: ${termController.address}`);
  console.log("maturity timestamp " + maturityTimestamp);
  const maturityDayJs = dayjs.unix(Number(servicerMaturityTimestamp));
  const redemptionTimestamp = maturityDayJs
    .add(Number(repurchaseWindow), "seconds")
    .add(Number(redemptionBuffer), "seconds")
    .unix()
    .toString();

  console.log("redemption timestamp " + redemptionTimestamp);

  const initializerAddressDefined = termInitializerAddress || "";

  const termRepoServicer = termRepoServicerAddress
    ? ((await ethers.getContractAt(
        termRepoServicerContractName,
        termRepoServicerAddress,
        managedSigner,
      )) as TermRepoServicer)
    : termRepoServicerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(termRepoServicerContractName, managedSigner),
        termRepoServicerContractName,
        termRepoServicerImplAddress || "",
        managedSigner,
        [
          termRepoId,
          servicerMaturityTimestamp,
          repurchaseWindow,
          redemptionBuffer,
          servicingFee,
          purchaseTokenAddress,
          termController.address,
          termEventEmitterAddress,
          initializerAddressDefined,
        ],
      )) as TermRepoServicer)
    : await deployTermContract<TermRepoServicer>(
        termRepoServicerContractName,
        [
          termRepoId,
          servicerMaturityTimestamp,
          repurchaseWindow,
          redemptionBuffer,
          servicingFee,
          purchaseTokenAddress,
          termController.address,
          termEventEmitterAddress,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termRepoCollateralManager = collateralManagerAddress
    ? ((await ethers.getContractAt(
        termRepoCollateralManagerContractName,
        collateralManagerAddress,
        managedSigner,
      )) as TermRepoCollateralManager)
    : collateralManagerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(
          termRepoCollateralManagerContractName,
          managedSigner,
        ),
        termRepoCollateralManagerContractName,
        collateralManagerImplAddress || "",
        managedSigner,
        [
          termRepoId,
          liquidateDamangesDueToProtocol,
          netExposureCapOnLiquidation,
          deMinimisMarginThreshold,
          purchaseTokenAddress,
          collateralMetadatas,
          termEventEmitterAddress,
          initializerAddressDefined,
        ],
      )) as TermRepoCollateralManager)
    : await deployTermContract<TermRepoCollateralManager>(
        termRepoCollateralManagerContractName,
        [
          termRepoId,
          liquidateDamangesDueToProtocol,
          netExposureCapOnLiquidation,
          deMinimisMarginThreshold,
          purchaseTokenAddress,
          collateralMetadatas,
          termEventEmitterAddress,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termRepoToken = termRepoTokenAddress
    ? ((await ethers.getContractAt(
        termRepoTokenContractName,
        termRepoTokenAddress,
        managedSigner,
      )) as TermRepoToken)
    : termRepoTokenImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(termRepoTokenContractName, managedSigner),
        termRepoTokenContractName,
        termRepoTokenImplAddress || "",
        managedSigner,
        [
          termRepoId,
          "TermRepoToken",
          "TESTTF",
          `${purchaseTokenDecimals}`,
          "1000000000000000000",
          mintExposureCap,
          initializerAddressDefined,
          {
            redemptionTimestamp:
              maturityTimestamp + repurchaseWindow + redemptionBuffer,
            purchaseToken: purchaseTokenAddress,
            collateralTokens: collateralTokenAddresses,
            maintenanceCollateralRatios,
          },
        ],
      )) as TermRepoToken)
    : await deployTermContract<TermRepoToken>(
        termRepoTokenContractName,
        [
          termRepoId,
          "TermRepoToken",
          "TESTTF",
          `${purchaseTokenDecimals}`,
          "1000000000000000000",
          mintExposureCap,
          initializerAddressDefined,
          {
            redemptionTimestamp:
              maturityTimestamp + repurchaseWindow + redemptionBuffer,
            purchaseToken: purchaseTokenAddress,
            collateralTokens: collateralTokenAddresses,
            maintenanceCollateralRatios,
          },
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termRepoLocker = repoLockerAddress
    ? ((await ethers.getContractAt(
        termRepoLockerContractName,
        repoLockerAddress,
        managedSigner,
      )) as TermRepoLocker)
    : repoLockerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(termRepoLockerContractName, managedSigner),
        termRepoLockerContractName,
        repoLockerImplAddress || "",
        managedSigner,
        [termRepoId, initializerAddressDefined],
      )) as TermRepoLocker)
    : await deployTermContract<TermRepoLocker>(
        termRepoLockerContractName,
        [termRepoId, initializerAddressDefined],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termAuctionBidLocker = bidLockerAddress
    ? ((await ethers.getContractAt(
        termAuctionBidLockerContractName,
        bidLockerAddress,
        managedSigner,
      )) as TermAuctionBidLocker)
    : bidLockerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(
          termAuctionBidLockerContractName,
          managedSigner,
        ),
        termAuctionBidLockerContractName,
        bidLockerImplAddress || "",
        managedSigner,
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          redemptionTimestamp,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
        ],
      )) as TermAuctionBidLocker)
    : await deployTermContract<TermAuctionBidLocker>(
        termAuctionBidLockerContractName,
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          redemptionTimestamp,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termAuctionOfferLocker = offerLockerAddress
    ? ((await ethers.getContractAt(
        termAuctionOfferLockerContractName,
        offerLockerAddress,
        managedSigner,
      )) as TermAuctionOfferLocker)
    : offerLockerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(
          termAuctionOfferLockerContractName,
          managedSigner,
        ),
        termAuctionOfferLockerContractName,
        offerLockerImplAddress || "",
        managedSigner,
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
        ],
      )) as TermAuctionOfferLocker)
    : await deployTermContract<TermAuctionOfferLocker>(
        termAuctionOfferLockerContractName,
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const auction = auctionAddress
    ? ((await ethers.getContractAt(
        auctionContractName,
        auctionAddress,
        managedSigner,
      )) as TermAuction)
    : auctionImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(auctionContractName, managedSigner),
        auctionContractName,
        auctionImplAddress || "",
        managedSigner,
        [
          termRepoId,
          termAuctionId,
          auctionEndDate,
          auctionEndDate,
          redemptionTimestamp,
          purchaseTokenAddress,
          clearingPricePostProcessingOffset,
        ],
      )) as TermAuction)
    : await deployTermContract<TermAuction>(
        auctionContractName,
        [
          termRepoId,
          termAuctionId,
          auctionEndDate,
          auctionEndDate,
          redemptionTimestamp,
          purchaseTokenAddress,
          initializerAddressDefined,
          clearingPricePostProcessingOffset,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const rolloverManager = rolloverManagerAddress
    ? ((await ethers.getContractAt(
        rolloverManagerContractName,
        rolloverManagerAddress,
        managedSigner,
      )) as TermRepoRolloverManager)
    : rolloverManagerImplAddress
    ? ((await deployContractUUPSProxyBeacon(
        await getContractFactory(rolloverManagerContractName, managedSigner),
        rolloverManagerContractName,
        rolloverManagerImplAddress || "",
        managedSigner,
        [
          termRepoId,
          termRepoServicer.address,
          termRepoCollateralManager.address,
          termController.address,
          initializerAddressDefined,
        ],
      )) as TermRepoRolloverManager)
    : await deployTermContract<TermRepoRolloverManager>(
        rolloverManagerContractName,
        [
          termRepoId,
          termRepoServicer.address,
          termRepoCollateralManager.address,
          termController.address,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );

  if (!pairTermContractsThruGnosis) {
    if (initializer && initializerForApproval) {
      // NOTE: This is the preferred method for contract setup as it batches all
      //       pairTermContract calls into a single transaction that either succeeds
      //       or fails.
      console.log("Resetting TermInitializer global contracts...");
      await retry(() =>
        initializer.pairTermContracts(
          termController.address,
          eventEmitter.address,
          oracle.address,
        ),
      );
      console.log("Pairing term contracts using TermInitializer...");
      const receipt = await retry(() =>
        initializerForApproval.setupTerm(
          {
            termRepoLocker: termRepoLocker.address,
            termRepoServicer: termRepoServicer.address,
            termRepoCollateralManager: termRepoCollateralManager.address,
            rolloverManager: rolloverManager.address,
            termRepoToken: termRepoToken.address,
            termAuctionOfferLocker: termAuctionOfferLocker.address,
            termAuctionBidLocker: termAuctionBidLocker.address,
            auction: auction.address,
          },
          devopsMultisig,
          adminWallet,
          termVersion,
          auctionVersion,
        ),
      );
      console.log("TermInitializer setupTerm tx hash:", receipt.hash);
      logGasCost(await receipt.wait(3));
    }
  }

  if (gelatoOps) {
    console.log("Scheduling gelato task for auction completion...");
    await scheduleCompleteAuctionTask(
      gelatoOps,
      auction,
      getEnv(completeAuctionKeeperCID),
    );
    console.log("Scheduling gelato task for batch process rollovers...");
    await scheduleBatchProcessRolloversTask(
      gelatoOps,
      rolloverManager,
      getEnv(batchProcessRolloversKeeperCID),
    );
  }

  return {
    termRepoId,
    termAuctionId,
    controller: termController,
    oracle,
    eventEmitter,

    termRepoServicer,
    termRepoCollateralManager,
    termRepoToken,
    termRepoLocker,
    termAuctionBidLocker,
    termAuctionOfferLocker,
    auction,
    rolloverManager,
  };
}

export async function deployAdditionalAuction(
  {
    termControllerAddress,
    termOracleAddress,
    termEventEmitterAddress,
    termInitializerAddress,
    auctionStartDate,
    auctionRevealDate,
    auctionEndDate,
    redemptionTimestamp,
    minimumTenderAmount,
    purchaseTokenAddress,
    collateralTokenAddresses,
    termRepoServicerAddress,
    collateralManagerAddress,
    bidLockerAddress,
    offerLockerAddress,
    auctionAddress,
    termApprovalMultisig,
    devopsMultisig,
    adminWallet,
    auctionVersion,
    clearingPricePostProcessingOffset = "1",
    clearingPriceDelta = "5000000",

    scheduleGelatoOps,
  }: {
    termControllerAddress: string;
    termOracleAddress: string;
    termEventEmitterAddress: string;
    termInitializerAddress: string;
    auctionStartDate: string;
    auctionRevealDate: string;
    auctionEndDate: string;
    redemptionTimestamp: string;
    minimumTenderAmount: string;
    purchaseTokenAddress: string;
    collateralTokenAddresses: string[];
    termRepoServicerAddress: string;
    collateralManagerAddress: string;
    bidLockerAddress?: string;
    offerLockerAddress?: string;
    auctionAddress?: string;
    clearingPriceDelta?: string;
    termApprovalMultisig: Signer;
    devopsMultisig: string;
    adminWallet: string;
    auctionVersion: string;
    clearingPricePostProcessingOffset: string;

    scheduleGelatoOps?: boolean;
  },
  kind: "uups" | "transparent" | "raw" = "uups",
): Promise<AdditionalAuctionInfo> {
  const [defaultSigner] = await ethers.getSigners();
  const managedSigner = new NonceManager(defaultSigner as any);
  let gelatoOps: GelatoOpsSDK | undefined;
  if (scheduleGelatoOps) {
    if (!hre.network.config.chainId) {
      throw new Error("Chain ID not set in network config");
    }
    gelatoOps = new GelatoOpsSDK(
      hre.network.config.chainId,
      managedSigner as any,
    );
  }
  const termRepoId = v4();
  const termAuctionId = v4();

  const termController = (await ethers.getContractAt(
    TermControllerABI,
    termControllerAddress,
    managedSigner,
  )) as TermController;

  const eventEmitter = (await ethers.getContractAt(
    TermEventEmitterABI,
    termEventEmitterAddress,
    managedSigner,
  )) as TermEventEmitter;
  const oracle: TermPriceConsumerV3 = (await ethers.getContractAt(
    "TermPriceConsumerV3",
    termOracleAddress,
    managedSigner,
  )) as TermPriceConsumerV3;
  const initializer: TermInitializer | undefined = termInitializerAddress
    ? ((await ethers.getContractAt(
        TermInitializerABI,
        termInitializerAddress,
        managedSigner,
      )) as TermInitializer)
    : undefined;
  const initializerForApproval: TermInitializer | undefined =
    termInitializerAddress
      ? ((await ethers.getContractAt(
          TermInitializerABI,
          termInitializerAddress,
          termApprovalMultisig,
        )) as TermInitializer)
      : undefined;

  const initializerAddressDefined = termInitializerAddress || "";

  const termRepoServicer: TermRepoServicer = (await ethers.getContractAt(
    "TermRepoServicer",
    termRepoServicerAddress,
    managedSigner,
  )) as TermRepoServicer;
  const termRepoCollateralManager: TermRepoCollateralManager =
    (await ethers.getContractAt(
      "TermRepoCollateralManager",
      collateralManagerAddress,
      managedSigner,
    )) as TermRepoCollateralManager;

  if (!termController.address) {
    throw new Error("Term Controller contract not found");
  }
  console.log(`TermController address: ${termController.address}`);

  const termAuctionBidLocker: TermAuctionBidLocker = bidLockerAddress
    ? await ethers.getContractAt(
        "TermAuctionBidLocker",
        bidLockerAddress,
        managedSigner,
      )
    : await deployTermContract<TermAuctionBidLocker>(
        "TermAuctionBidLocker",
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          redemptionTimestamp,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const termAuctionOfferLocker: TermAuctionOfferLocker = offerLockerAddress
    ? await ethers.getContractAt(
        "TermAuctionOfferLocker",
        offerLockerAddress,
        managedSigner,
      )
    : await deployTermContract<TermAuctionOfferLocker>(
        "TermAuctionOfferLocker",
        [
          termRepoId,
          termAuctionId,
          auctionStartDate,
          auctionRevealDate,
          auctionEndDate,
          minimumTenderAmount,
          purchaseTokenAddress,
          collateralTokenAddresses,
          initializerAddressDefined,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );
  const auction: TermAuction = auctionAddress
    ? await ethers.getContractAt("TermAuction", auctionAddress, managedSigner)
    : await deployTermContract<TermAuction>(
        "TermAuction",
        [
          termRepoId,
          termAuctionId,
          auctionEndDate,
          auctionEndDate,
          redemptionTimestamp,
          purchaseTokenAddress,
          initializerAddressDefined,
          clearingPricePostProcessingOffset,
        ],
        kind,
        termController,
        eventEmitter,
        managedSigner,
      );

  console.log("pairing contracts with initializer");
  if (initializer && initializerForApproval) {
    // NOTE: This is the preferred method for contract setup as it batches all
    //       pairTermContract calls into a single transaction that either succeeds
    //       or fails.
    console.log("Resetting TermInitializer global contracts...");
    await retry(() =>
      initializer.pairTermContracts(
        termController.address,
        eventEmitter.address,
        oracle.address,
      ),
    );
    console.log("Pairing term contracts using TermInitializer...");
    const receipt = await retry(() =>
      initializerForApproval.setupAuction(
        termRepoServicer.address,
        termRepoCollateralManager.address,
        termAuctionOfferLocker.address,
        termAuctionBidLocker.address,
        auction.address,
        devopsMultisig,
        adminWallet,
        auctionVersion,
      ),
    );
    console.log("TermInitializer setupAuction tx hash:", receipt.hash);
    logGasCost(await receipt.wait(3));
  }

  if (gelatoOps) {
    console.log("Scheduling gelato task for auction completion...");
    await scheduleCompleteAuctionTask(
      gelatoOps,
      auction,
      getEnv(completeAuctionKeeperCID),
    );
  }

  return {
    termRepoId,
    termAuctionId,
    controller: termController,

    oracle,
    termRepoServicer,
    termRepoCollateralManager,
    termAuctionBidLocker,
    termAuctionOfferLocker,
    auction,
  };
}

export const saveContractAddress = (
  addresses: Record<string, string>,
  configFile = ".deployed-contracts.json",
) => {
  // Load the existing addresses
  const existingAddresses = existsSync(configFile)
    ? JSON.parse(readFileSync(configFile, "utf8"))
    : ({} as Record<string, string>);
  const mergedAddresses = {
    ...existingAddresses,
    ...addresses,
  };

  writeFileSync(configFile, JSON.stringify(mergedAddresses, null, 2));
};

export function infoToDotenv(info: MaturityPeriodInfo): string {
  return `${termControllerEnvVar}=${info.controller?.address}

${termRepoServicerEnvVar}=${info.termRepoServicer.address}
${collateralManagerEnvVar}=${info.termRepoCollateralManager.address}
${poolEnvVar}=${info.termRepoLocker.address}
${termRepoTokenEnvVar}=${info.termRepoToken.address}
${auctionEnvVar}=${info.auction.address}
${bidLockerEnvVar}=${info.termAuctionBidLocker.address}
${offerLockerEnvVar}=${info.termAuctionOfferLocker.address}
${oracleEnvVar}=${info.oracle.address}`;
}

export function infoToJSON(info: MaturityPeriodInfo) {
  return {
    [termControllerEnvVar]: info.controller?.address,
    [termEventEmitterEnvVar]: info.eventEmitter?.address,

    [termRepoServicerEnvVar]: info.termRepoServicer.address,
    [collateralManagerEnvVar]: info.termRepoCollateralManager.address,
    [poolEnvVar]: info.termRepoLocker.address,
    [termRepoTokenEnvVar]: info.termRepoToken.address,
    [auctionEnvVar]: info.auction.address,
    [bidLockerEnvVar]: info.termAuctionBidLocker.address,
    [offerLockerEnvVar]: info.termAuctionOfferLocker.address,
    [oracleEnvVar]: info.oracle.address,
  } as Record<string, string>;
}

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export function getEnvList(key: string, defaultValue?: string): string[] {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value.split(",");
}

export const termControllerEnvVar = "REACT_APP_TERM_CONTROLLER_ADDRESS";
export const termEventEmitterEnvVar = "REACT_APP_TERM_EVENT_EMITTER_ADDRESS";
export const termInitializerEnvVar = "REACT_APP_TERM_INITIALIZER_ADDRESS";

export const oracleEnvVar = "REACT_APP_PRICE_ORACLE_ADDRESS";

export const termRepoServicerEnvVar =
  "REACT_APP_TERM_LOAN_MANAGER_CONTRACT_ADDRESS";
export const collateralManagerEnvVar =
  "REACT_APP_TERM_COLLATERAL_MANAGER_CONTRACT_ADDRESS";
export const rolloverManagerEnvVar =
  "REACT_APP_TERM_ROLLOVER_MANAGER_CONTRACT_ADDRESS";
export const poolEnvVar = "REACT_APP_TERM_POOL_CONTRACT_ADDRESS";
export const termRepoTokenEnvVar = "REACT_APP_TERM_TOKEN_CONTRACT_ADDRESS";
export const auctionEnvVar = "REACT_APP_TERM_AUCTION_CONTRACT_ADDRESS";
export const bidLockerEnvVar =
  "REACT_APP_TERM_AUCTION_BID_LOCKER_CONTRACT_ADDRESS";
export const offerLockerEnvVar =
  "REACT_APP_TERM_AUCTION_OFFER_LOCKER_CONTRACT_ADDRESS";

export const termRepoServicerImplEnvVar =
  "REACT_APP_TERM_LOAN_MANAGER_IMPL_CONTRACT_ADDRESS";
export const collateralManagerImplEnvVar =
  "REACT_APP_TERM_COLLATERAL_MANAGER_IMPL_CONTRACT_ADDRESS";
export const rolloverManagerImplEnvVar =
  "REACT_APP_TERM_ROLLOVER_MANAGER_IMPL_CONTRACT_ADDRESS";
export const poolImplEnvVar = "REACT_APP_TERM_POOL_IMPL_CONTRACT_ADDRESS";
export const termRepoTokenImplEnvVar =
  "REACT_APP_TERM_TOKEN_IMPL_CONTRACT_ADDRESS";
export const auctionImplEnvVar = "REACT_APP_TERM_AUCTION_IMPL_CONTRACT_ADDRESS";
export const bidLockerImplEnvVar =
  "REACT_APP_TERM_AUCTION_BID_LOCKER_IMPL_CONTRACT_ADDRESS";
export const offerLockerImplEnvVar =
  "REACT_APP_TERM_AUCTION_OFFER_LOCKER_IMPL_CONTRACT_ADDRESS";

export const termIdEnvVar = "TERM_ID";
export const auctionIdEnvVar = "TERM_AUCTION_ID";
export const auctionEndEnvVar = "TERM_AUCTION_END_TIMESTAMP";
export const auctionDurationEnvVar = "TERM_AUCTION_DURATION";
export const revealDurationEnvVar = "TERM_AUCTION_REVEAL_DURATION";
export const repurchaseWindowEnvVar = "TERM_LOAN_REPAYMENT_WINDOW";
export const rolloverBufferEnvVar = "TERM_LOAN_ROLLOVER_BUFFER";
export const redemptionBufferEnvVar = "TERM_LOAN_REDEMPTION_BUFFER";
export const termLengthEnvVar = "TERM_LOAN_LENGTH";
export const mintExposureCapEnvVar = "TERM_MINT_EXPOSURE_CAP";

export const netExposureCapOnLiquidationEnvVar =
  "TERM_NET_EXPOSURE_CAP_ON_LIQUIDATION";
export const deMinimisMarginThresholdEnvVar = "TERM_DEMINIMIS_MARGIN_THRESHOLD";

export const termMinimumTenderAmountEnvVar = "TERM_MINIMNUM_TENDER_AMOUNT";
export const protocolLiquidationSeizeShareEnvVar =
  "TERM_PROTOCOL_LIQUIDATION_SEIZE_SHARE";
export const protocolLoanShareEnvVar = "TERM_PROTOCOL_LOAN_SHARE";
export const maintenanceRatioEnvVar = "TERM_COLLATERAL_MAINTENANCE_RATIO";
export const initialCollateralRatioEnvVar = "TERM_COLLATERAL_INITIAL_RATIO";
export const liquidatedDamagesEnvVar = "TERM_COLLATERAL_LIQUIDATION_DISCOUNT";

export const clearingPriceDeltaEnvVar = "TERM_CLEARING_PRICE_DELTA";

export const purchaseTokenAddressEnvVar = "TERM_PURCHASE_TOKEN_ADDRESS";
export const collateralTokenAddressEnvVar = "TERM_COLLATERAL_TOKEN_ADDRESS";
export const purchaseTokenUsdOracleAddressEnvVar =
  "TERM_PURCHASE_TOKEN_USD_ORACLE_ADDRESS";
export const collateralTokenUsdOracleAddressEnvVar =
  "TERM_COLLATERAL_TOKEN_USD_ORACLE_ADDRESS";

export const termApprovalMultiSigAddressEnvVar =
  "TERM_APPROVAL_MULTISIG_ADDRESS";
export const devopsMultiSigAddressEnvVar = "TERM_DEVOPS_MULTISIG_ADDRESS";
export const adminWalletAddressEnvVar = "TERM_DEVOPS_ADMIN_WALLET_ADDRESS";

export const controllerAdminAddressEnvVar = "TERM_CONTROLLER_ADMIN_ADDRESS";
export const evergreenManagementAddressEnvVar =
  "TERM_EVERGREEN_MANAGEMENT_ADDRESS";

export const deploymentKindEnvVar = "TERM_DEPLOYMENT_KIND";

export const completeAuctionKeeperCID = "COMPLETE_AUCTION_KEEPER_CID";
export const batchProcessRolloversKeeperCID =
  "BATCH_PROCESS_ROLLOVERS_KEEPER_CID";

export const evergreenManagementOwnerEnvVar = "TERM_EVERGREEN_MANAGEMENT_OWNER";
