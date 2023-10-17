import { Contract, ContractFactory, Signer } from "ethers";
import ERC1967Proxy from "./artifacts/ERC1967Proxy.json";
import { formatEther, formatUnits } from "ethers/lib/utils";
import { TransactionResponse } from "@ethersproject/abstract-provider";

export const checkDeploymentTxn = async (
  deploymentTxn: TransactionResponse | null | undefined,
  contractAddress: string,
  confirmations = 3
) => {
  if (!deploymentTxn) {
    throw new Error(
      `No deployment transaction found for contract ${contractAddress}`
    );
  }
  const receipt = await deploymentTxn?.wait(confirmations);
  if (!receipt) {
    throw new Error(
      `No receipt found for contract deployment transaction ${deploymentTxn?.hash}`
    );
  }
  return {
    receipt,
    deploymentTxn,
  };
};

export const deployContractUUPSProxyBeacon = async (
  contract: ContractFactory,
  contractName: string,
  proxyImpl: string,
  wallet: Signer,
  initializationArgs: any[]
): Promise<Contract> => {
  const confirmations = 3;

  const walletAddr = await wallet.getAddress();

  console.debug(
    `Deploying ERC1967Proxy for ${contractName}: using wallet ${walletAddr}...`
  );

  const initializeData = contract.interface.encodeFunctionData(
    "initialize",
    initializationArgs
  );

  const proxyFactory = new ContractFactory(
    ERC1967Proxy.abi,
    ERC1967Proxy.bytecode,
    wallet
  );
  const proxy = await proxyFactory.deploy(proxyImpl, initializeData);
  const proxyAddress = await proxy.getAddress();
  const { receipt: proxyReceipt, deploymentTxn: proxyDeploymentTxn } =
    await checkDeploymentTxn(
      proxy.deployTransaction,
      proxyAddress,
      confirmations
    );

  const state = {
    address: proxyAddress,
    implAddress: proxyImpl,
    transactions: [
      {
        transaction: proxyDeploymentTxn.hash,
        transactionFeesETH: formatEther(
          proxyReceipt.gasUsed.mul(proxyReceipt.effectiveGasPrice)
        ),
        gasUsed: proxyReceipt.gasUsed.toString(),
        gasPriceGWEI: formatUnits(proxyReceipt.effectiveGasPrice, "gwei"),
      },
    ],
  };

  console.log("Proxy deployed");
  console.log(JSON.stringify(state));

  return proxy;
};
