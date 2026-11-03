import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import "@openzeppelin/hardhat-upgrades";
import "solidity-docgen";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
// import * as tdly from "@tenderly/hardhat-tenderly";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

dotenv.config();
// tdly.setup();

const isCoverage =
  process.argv.includes("coverage") || process.env.COVERAGE === "true";

// Coverage instrumentation needs a higher optimizer runs count and yul details
// on the Aave facet (and its test helper) than the rest of the contracts use.
const coverageAaveOverride = {
  version: "0.8.22",
  settings: {
    evmVersion: "paris",
    optimizer: {
      runs: 50,
      enabled: true,
      details: {
        yul: true,
        yulDetails: { stackAllocation: true, optimizerSteps: "" },
      },
    },
    viaIR: true,
  },
};

// Override the compile task to run our script AFTER ABI export
task("compile").setAction(async (args, hre, runSuper) => {
  // Run the normal compile task (which includes ABI export)
  const result = await runSuper(args);

  // Now run our merge script after ABIs have been exported
  try {
    const { stdout } = await execAsync(
      "yarn ts-node scripts/merge-erc20-errors.ts",
    );
    console.log(stdout);
  } catch (error) {
    console.warn("Warning: Failed to merge ERC20 errors:", error);
  }

  return result;
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.22",
        settings: {
          evmVersion: "paris",
          outputSelection: {
            "*": {
              "*": [
                "evm.bytecode",
                "evm.deployedBytecode",
                "devdoc",
                "userdoc",
                "metadata",
                "abi",
              ],
            },
          },
          optimizer: {
            runs: 1,
            enabled: true,
          },
          viaIR: true,
        },
      },
    ],
    ...(isCoverage && {
      overrides: {
        "contracts/facets/external/TermAaveInterfaceFacet.sol":
          coverageAaveOverride,
        "contracts/test/TestTermAaveInterfaceFacetHelper.sol":
          coverageAaveOverride,
      },
    }),
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY!,
      sepolia: process.env.ETHERSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=11155111",
          browserURL: "https://sepolia.etherscan.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: true,
  },
  // settings: {
  //   outputSelection: {
  //     "*": {
  //       "*": ["storageLayout"],
  //     }
  //   }
  // },
  docgen: {
    exclude: [
      "test",
      "ERC1967Proxy.sol",
      "lib/MultiSend.sol",
      "lib/ExponentialNoError.sol",
      "interfaces",
      // TODO: Re-enable once we have a better way to link doc pages.
      "lib",
    ],
    pages: "files",
  },
  abiExporter: {
    runOnCompile: true,
    clear: true,
    flat: true,
    format: "json",
    except: [
      // Exclude conflicting Errors/IERC20/ERC20 declarations pulled in from node_modules.
      // Anchored to the specific source:contract so we don't also drop production
      // interfaces such as contracts/interfaces/ITermRepoLockerErrors.sol.
      "@openzeppelin/contracts/utils/Errors.sol",
      "@pendle/core-v2/contracts/core/libraries/Errors.sol",
      "@openzeppelin/contracts/token/ERC20/IERC20.sol",
      "@openzeppelin/contracts/interfaces/IERC20.sol",
      "@openzeppelin/contracts/token/ERC20/ERC20.sol",
      "SettlerFlattened.sol",
      // Conflicting inline interfaces declared in production facets. Anchored to the
      // exact fully-qualified name so unrelated contracts aren't matched.
      "contracts/facets/TermStrategyFacet.sol:IStrategy$",
      "contracts/facets/flashloan/TermFlashLoanExecutorFacet.sol:IFlashLoanAggregator$",
      // Tooling/proxy contracts that aren't part of the protocol ABI surface.
      "ERC1967Proxy.sol",
      "lib/MultiSend.sol",
      // All test mocks and helpers under contracts/test/. Anchored regex against the
      // fully-qualified name (sourceName:contractName), which starts with the source path.
      "^contracts/test/",
    ],
  },
  networks: {
    hardhat: {
      mining: {
        interval: 1000, // Automatically mine (even empty blocks) every x milliseconds.
        auto: true,
      },
      accounts: {
        count: 50,
      },
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true,
    },
  },
  // tenderly: {
  //   username: "andrew_tff",
  //   project: "project",
  // },
  mocha: {
    timeout: 120000,
  },
};

// Shared test wallets, used by both the sepolia and mainnet network configs below.
const testWallet = process.env.TEST_WALLET;
const testerWallets = process.env.TESTER_WALLETS?.split(",");

// Setup sepolia test network.
const sepoliaRPC = process.env.SEPOLIA_RPC;
if (sepoliaRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.sepolia = {
    url: sepoliaRPC,
    accounts: testWallet ? [testWallet, ...(testerWallets || [])] : [],
    gas: "auto",
    gasPrice: 35000000000,
    chainId: 11155111,
  };
}

const mainnetRPC = process.env.MAINNET_RPC;
if (testWallet && mainnetRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.mainnet = {
    url: mainnetRPC,
    accounts: [testWallet, ...(testerWallets || [])],
    gas: "auto",
    gasPrice: "auto",
    chainId: 1,
  };
}

// Setup tenderly test network.
const tenderlyForkUrl = process.env.TENDERLY_FORK_URL;
const tenderlyTestWallet = process.env.TENDERLY_TEST_WALLET;
const tenderlyTesterWallets = process.env.TENDERLY_TESTER_WALLETS?.split(",");
if (tenderlyTestWallet && tenderlyForkUrl) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.tenderly = {
    url: tenderlyForkUrl,
    accounts: [tenderlyTestWallet, ...(tenderlyTesterWallets || [])],
    gas: "auto",
    gasPrice: "auto",
    gasMultiplier: 2,
  };
}

export default config;
