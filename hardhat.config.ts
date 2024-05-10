import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "@openzeppelin/hardhat-upgrades";
import "solidity-docgen";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
import * as tdly from "@tenderly/hardhat-tenderly";
import * as fs from "fs";

dotenv.config();
tdly.setup();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.18",
    settings: {
      optimizer: {
        runs: 50,
        enabled: true,
      },
    },
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
    ],
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
      "test/TestingTermAuction.sol",
      "test/TestingTermAuctionBidLocker.sol",
      "test/TestingTermAuctionOfferLocker.sol",
      "test/TestnetToken.sol",
      "test/TestPriceFeed.sol",
      "test/TestTermController.sol",
      "test/TestTermEventEmitter.sol",
      "test/TetTermPriceConsumerV3.sol",
      "test/TermRepoCollateralManager.sol",
      "test/TestTermRepoLocker.sol",
      "test/TestTermRepoRolloverManager.sol",
      "test/TestTermRepoServicer.sol",
      "test/TestTermRepoToken.sol",
      "ERC1967Proxy.sol",
      "lib/MultiSend.sol",
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
  tenderly: {
    username: "andrew_tff",
    project: "project",
  },
  mocha: {
    timeout: 120000,
  },
};

// Setup goerli test network.
const alchemyApiKey = process.env.ALCHEMY_API_KEY;
const goerliRPC = process.env.GOERLI_RPC;
const goerliTestWallet = process.env.GOERLI_TEST_WALLET;
const goerliTesterWallets = process.env.GOERLI_TESTER_WALLETS?.split(",");
if (goerliTestWallet && (goerliRPC || alchemyApiKey)) {
  if (!config.networks) {
    config.networks = {};
  }

  config.networks.goerli = {
    url: goerliRPC ?? `https://eth-goerli.alchemyapi.io/v2/${alchemyApiKey}`,
    accounts: [goerliTestWallet, ...(goerliTesterWallets || [])],
    gas: "auto",
    gasPrice: 50000000000,
    gasMultiplier: 2,
  };
}

// Setup base-goerli test network.
const baseGoerliRPC = process.env.BASE_GOERLI_RPC;
if (goerliTestWallet && baseGoerliRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.baseGoerli = {
    url: baseGoerliRPC,
    accounts: [goerliTestWallet, ...(goerliTesterWallets || [])],
    gas: "auto",
    gasPrice: 35000000000,
    chainId: 84531,
  };
}

// Setup base-goerli test network.
const sepoliaRPC = process.env.SEPOLIA_RPC;
if (goerliTestWallet && sepoliaRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.sepolia = {
    url: sepoliaRPC,
    accounts: [goerliTestWallet, ...(goerliTesterWallets || [])],
    gas: "auto",
    gasPrice: 35000000000,
    chainId: 11155111,
  };
}

const mumbaiRPC = process.env.MUMBAI_RPC;
if (goerliTestWallet && mumbaiRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.polygon_mumbai = {
    url: mumbaiRPC,
    accounts: [goerliTestWallet, ...(goerliTesterWallets || [])],
    gas: "auto",
    gasPrice: 25500000000,
    chainId: 80001,
  };
}

const mainnetRPC = process.env.MAINNET_RPC;
if (goerliTestWallet && mainnetRPC) {
  if (!config.networks) {
    config.networks = {};
  }
  config.networks.mainnet = {
    url: mainnetRPC,
    accounts: [goerliTestWallet, ...(goerliTesterWallets || [])],
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
