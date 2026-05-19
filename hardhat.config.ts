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
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

dotenv.config();
// tdly.setup();

const isCoverage = process.argv.includes("coverage") || process.env.COVERAGE === "true";

// Override the compile task to run our script AFTER ABI export
task("compile").setAction(async (args, hre, runSuper) => {
  // Run the normal compile task (which includes ABI export)
  const result = await runSuper(args);

  // Now run our merge script after ABIs have been exported
  try {
    const { stdout } = await execAsync("yarn ts-node scripts/merge-erc20-errors.ts");
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
          "evmVersion": "paris",
          "outputSelection": {
            "*": {
              "*": [
                "evm.bytecode",
                "evm.deployedBytecode",
                "devdoc",
                "userdoc",
                "metadata",
                "abi"
              ]
            }
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
        "contracts/facets/external/TermAaveInterfaceFacet.sol": {
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
        },
        "contracts/test/TestTermAaveInterfaceFacetHelper.sol": {
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
        },
      },
    }),
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: {
      baseGoerli: "placeholder",
      mainnet: process.env.ETHERSCAN_API_KEY!,
      polygon_mumbai: process.env.ETHERSCAN_API_KEY!,
      sepolia: process.env.ETHERSCAN_API_KEY!,
    },
    customChains: [
      {
        network: "baseGoerli",
        chainId: 84531,
        urls: {
          apiURL: "https://api-goerli.basescan.org/api",
          browserURL: "https://goerli.basescan.org",
        },
      },
      {
        network: "polygon_mumbai",
        chainId: 80001,
        urls: {
          apiURL: "https://api-testnet.polygonscan.com/api",
          browserURL: "https://api-testnet.polygonscan.com",
        },
      },
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
    // templates: "docs-templates",
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
      // Exclude conflicting Errors libraries from node_modules
      "@openzeppelin/contracts/utils/Errors.sol",
      "@pendle/core-v2/contracts/core/libraries/Errors.sol",
      // Exclude conflicting IERC20 interfaces from OpenZeppelin
      "@openzeppelin/contracts/token/ERC20/IERC20.sol",
      "@openzeppelin/contracts/interfaces/IERC20.sol",
      "IStrategy.sol",
      "SettlerFlattened.sol",
      "ERC20.sol",
      "Errors.sol",
      "test/TestingTermAuction.sol",
      "test/TestingTermAuctionBidLocker.sol",
      "test/TestingTermAuctionOfferLocker.sol",
      "test/TestnetToken.sol",
      "test/TestPriceFeed.sol",
      "test/TestTermController.sol",
      "test/TestTermEventEmitter.sol",
      "test/TestTermPriceConsumerV3.sol",
      "test/TermRepoCollateralManager.sol",
      "test/TestTermRepoLocker.sol",
      "test/TestTermRepoRolloverManager.sol",
      "test/TestTermRepoServicer.sol",
      "test/TestTermRepoToken.sol",
      "ERC1967Proxy.sol",
      "lib/MultiSend.sol",
      "ERC20.sol",
      "IStrategy",
      "FlashLoanAggregator"
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

// Setup goerli test network.
const testWallet = process.env.GOERLI_TEST_WALLET;
const testerWallets = process.env.GOERLI_TESTER_WALLETS?.split(",");

// Setup base-goerli test network.
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

// Custom task to log the standard JSON input
task(
  "logStandardJsonInput",
  "Prints the standard JSON input of the compilation",
  async (_, { artifacts }) => {
    const artifactPaths = await artifacts.getArtifactPaths();

    artifactPaths.forEach((path) => {
      const artifact = require(path);
      console.log(JSON.stringify(artifact._format, null, 2));
      // Optionally write to a file
      fs.writeFileSync(
        `./artifacts/${artifact.contractName}-input.json`,
        JSON.stringify(artifact._format, null, 2),
      );
    });
  },
);

export default config;
