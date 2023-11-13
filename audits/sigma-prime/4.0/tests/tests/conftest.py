import json
import os
import types
from typing import Dict, Tuple

import brownie
import pytest
from brownie import web3, chain

# To setup before the function-level snapshot,
# put a module-level autouse fixture like the following in your test module.
#
# @pytest.fixture(scope="module", autouse=True)
# def initial_state(base_setup):
#     """This relies on base_setup, so ensure it's loaded
#     before any function-level isolation."""
#     # Put any other module-specific setup you'd like in here
#     pass


# NOTE: if wanting to adjust things slightly, you can also override some
# individual fixture (within some scope).

# TODO enable?
# Could enable it, but the brownie middleware could still do its own conversions,
# so can't really rely on it
# w3.enable_strict_bytes_type_checking()


# Type aliases
# includes ProjectContract and Contract instances
CONTRACT_INSTANCE = brownie.network.contract._DeployedContractBase
NAME_WITH_INSTANCE = Tuple[str, CONTRACT_INSTANCE]
NAME_TO_INSTANCE = Dict[str, CONTRACT_INSTANCE]


@pytest.fixture(scope="module", autouse=True)
def mod_isolation(module_isolation):
    """Snapshot ganache at start of module."""
    pass


@pytest.fixture(autouse=True)
def isolation(fn_isolation):
    """Snapshot ganache before every test function call."""
    pass


@pytest.fixture(scope="session")
def constants():
    """Parameters used in the default setup/deployment, useful constants."""
    return types.SimpleNamespace(
        ZERO_ADDRESS=brownie.ZERO_ADDRESS,
        STABLE_SUPPLY=1_000_000_000_000 * 10**6,
        WBTC_SUPPLY=1_000_000_000 * 10**8,
        MAX_UINT256=2**256 - 1,
        MAX_BID_PRICE=100000000000000000000,
        MAX_OFFER_PRICE=100000000000000000000,
        ROLLOVER_MANAGER=web3.keccak(text="ROLLOVER_MANAGER"),
        ADMIN_ROLE=web3.keccak(text="ADMIN_ROLE"),
        DEVOPS_ROLE=web3.keccak(text="DEVOPS_ROLE"),
        INITIALIZER_ROLE=web3.keccak(text="INITIALIZER_ROLE"),
        ROLLOVER_BID_FULFILLER_ROLE=web3.keccak(text="ROLLOVER_BID_FULFILLER_ROLE"),
    )


# Pytest Adjustments
####################

# Copied from
# https://docs.pytest.org/en/latest/example/simple.html?highlight=skip#control-skipping-of-tests-according-to-command-line-option


def pytest_addoption(parser):
    parser.addoption("--runslow", action="store_true", default=False, help="run slow tests")


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: mark test as slow to run")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--runslow"):
        # --runslow given in cli: do not skip slow tests
        return
    skip_slow = pytest.mark.skip(reason="need --runslow option to run")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip_slow)


## Account Fixtures
###################

# Generate some new local accounts
@pytest.fixture(scope="session")
def users(accounts, owner):
    acc = []
    for i in range(0, 4):
        newAcc = accounts.add()
        owner.transfer(newAcc, "10 ether")
        assert newAcc.balance() == web3.toWei(10, "ether")
        acc.append(newAcc)
    return acc


@pytest.fixture(scope="session")
def owner(accounts):
    """Account used as the default owner/guardian."""
    return accounts[0]


@pytest.fixture(scope="session")
def proxy_admin(accounts):
    """
    Account used as the admin to proxies.
    Use this account to deploy proxies as it allows the default account (i.e. accounts[0])
    to call contracts without setting the `from` field.
    """
    return accounts[1]


@pytest.fixture(scope="session")
def treasuryAddress(accounts):
    return accounts[2]


@pytest.fixture(scope="session")
def protocolReserveAddress(accounts):
    return accounts[3]


@pytest.fixture(scope="session")
def lostAndFoundAddr(accounts):
    """Account used as Lost and Found Address for USDC V2."""
    return accounts[4]


@pytest.fixture(scope="session")
def controllerAdmin(accounts):
    return accounts[5]


@pytest.fixture(scope="session")
def devOps(accounts):
    return accounts[6]


@pytest.fixture(scope="session")
def evergreenManagement(accounts):
    return accounts[7]


@pytest.fixture(scope="session")
def delister(accounts):
    return accounts[8]


# Adding user accounts with available private keys
@pytest.fixture(scope="session")
def alice(users):
    return users[0]


@pytest.fixture(scope="session")
def bob(users):
    return users[1]


@pytest.fixture(scope="session")
def carol(users):
    return users[2]


@pytest.fixture(scope="session")
def digby(users):
    return users[3]


## Helper for UUPS proxy contracts
@pytest.fixture(scope="module")
def UUPS_proxy_deploy_and_initialize(owner, ERC1967Proxy):
    """
    Returns a function that will deploy and initialize a UUPSUpgradeable Proxy
    """

    def method(Contract, params):
        # Deploy implementation
        implementation = Contract.deploy({"from": owner})

        # Prepare data to call `initialize(params)`
        data = implementation.initialize.encode_input(*params)

        # Deploy contract and call `initialize()`
        proxy = ERC1967Proxy.deploy(implementation, data, {"from": owner})

        # Convert proxy contract to implementation, so we can use implementation functions directly
        proxy_as_implementation = brownie.network.contract.Contract.from_abi(
            "proxy contract", proxy.address, Contract.abi
        )

        return (proxy_as_implementation, implementation, proxy)

    return method


## Deploy Compiled Contracts

# Deployer routine to build from a compiled contract
def build_deployer(file_name, deployer, *args):
    """
    Deploy from compiled contract which should be in JSON.
    The contract should be stored locally inside "compiled" folder.
    If folder name change is required, modify the folder_path variable.
    """

    dir_path = os.path.dirname(os.path.realpath(__file__))
    folder_path = dir_path + "/../compiled"
    json_path = folder_path + "/" + file_name

    with open(json_path) as f:
        data = json.load(f)

    abi = data["abi"]
    bytecode = data["bytecode"]

    web3.eth.default_account = deployer
    contract = web3.eth.contract(abi=abi, bytecode=bytecode)
    tx_hash = contract.constructor(*args).transact({"from": str(deployer)})
    tx_receipt = web3.eth.wait_for_transaction_receipt(tx_hash)
    contract_instance = brownie.network.contract.Contract.from_abi(
        "contract", tx_receipt.contractAddress, abi
    )
    return contract_instance


@pytest.fixture(scope="module")
def deploy_weth(owner):
    """
    Deploy Wrapped Ether (WETH) using WETH9 contract.
    """

    folder_name = "weth"
    # deploy WETH
    weth_file = folder_name + "/" + "WETH9.json"
    # constructor arguments
    args = []
    # deployment
    weth = build_deployer(weth_file, owner, *args)

    return weth


@pytest.fixture(scope="module")
def deploy_usdt(owner, constants):
    """
    Deploy Tether (USDT) stablecoin.
    Initial supply is transferred to owner.
    """

    folder_name = "tether"
    # TetherToken
    file_name = folder_name + "/" + "TetherToken.json"
    # constructor arguments
    name = "Tether USD"
    symbol = "USDT"
    initial_supply = constants.STABLE_SUPPLY
    decimals = 6
    args = [initial_supply, name, symbol, decimals]
    # deployment
    usdt = build_deployer(file_name, owner, *args)

    return usdt


@pytest.fixture(scope="module")
def deploy_usdc(owner, proxy_admin, lostAndFoundAddr, constants):
    """
    Deploy USD Coin stablecoin.
    """

    folder_name = "usdc"

    # FiatTokenV1
    file_name = folder_name + "/" + "FiatTokenV1.json"
    # constructor arguments
    args = []
    # deployment
    fiat_token_v1 = build_deployer(file_name, proxy_admin, *args)

    # FiatTokenV1_1
    # Not really used
    # file_name = folder_name + "/" + "FiatTokenV1_1.json"
    # # constructor arguments
    # args = []
    # # deployment
    # fiat_token_v1_1 = build_deployer(file_name, proxy_admin, *args)

    # FiatTokenV2
    file_name = folder_name + "/" + "FiatTokenV2.json"
    # constructor arguments
    args = []
    # deployment
    fiat_token_v2 = build_deployer(file_name, proxy_admin, *args)

    # FiatTokenV2_1
    file_name = folder_name + "/" + "FiatTokenV2_1.json"
    # constructor arguments
    args = []
    # deployment
    fiat_token_v2_1 = build_deployer(file_name, proxy_admin, *args)

    # FiatTokenProxy
    file_name = folder_name + "/" + "FiatTokenProxy.json"
    # constructor arguments
    args = [fiat_token_v1.address]
    # deployment
    proxy = build_deployer(file_name, proxy_admin, *args)

    # implementation V1
    token_name = "USD Coin"
    token_symbol = "USDC"
    token_currency = "USD"
    token_decimals = 6
    new_master_minter = owner
    new_pauser = owner
    new_black_lister = owner
    new_owner = owner
    params = [
        token_name,
        token_symbol,
        token_currency,
        token_decimals,
        new_master_minter,
        new_pauser,
        new_black_lister,
        new_owner,
    ]
    data = fiat_token_v1.initialize.encode_input(*params)

    # upgradeToAndCall to FiatTokenV1
    proxy.upgradeToAndCall(fiat_token_v1.address, data, {"from": proxy_admin})

    # implementation V2
    new_name = "USD Coin"
    params = [new_name]
    data = fiat_token_v2.initializeV2.encode_input(*params)

    # upgradeToAndCall to FiatTokenV2
    proxy.upgradeToAndCall(fiat_token_v2.address, data, {"from": proxy_admin})

    # implementation V2_1
    lost_and_found = lostAndFoundAddr
    params = [lost_and_found]
    data = fiat_token_v2_1.initializeV2_1.encode_input(*params)

    # upgradeToAndCall to FiatTokenV2_1
    proxy.upgradeToAndCall(fiat_token_v2_1.address, data, {"from": proxy_admin})

    proxy_as_implementation = brownie.network.contract.Contract.from_abi(
        "proxy contract", proxy.address, fiat_token_v2_1.abi
    )

    # configure owner as minter
    usdc = proxy_as_implementation
    usdc.configureMinter(owner, constants.STABLE_SUPPLY, {"from": owner})

    return usdc


@pytest.fixture(scope="module")
def deploy_wbtc(owner):
    """
    Deploy Wrapped Bitcoin (WBTC).
    """

    folder_name = "wbtc"
    # deploy WBTC
    wbtc_file = folder_name + "/" + "WBTC.json"
    # constructor arguments
    name = "Wrapped BTC"
    symbol = "WBTC"
    decimals = 8
    args = [name, symbol, decimals]
    # deployment
    wbtc = build_deployer(wbtc_file, owner, *args)

    return wbtc


# Main Deployment
#################
@pytest.fixture(scope="module")
def setup_environment(owner, constants, deploy_usdc, deploy_wbtc, deploy_weth):
    contracts = {"usdc": deploy_usdc, "wbtc": deploy_wbtc, "weth": deploy_weth}

    contracts["usdc"].mint(owner, constants.STABLE_SUPPLY, {"from": owner})
    contracts["wbtc"].mint(owner, constants.WBTC_SUPPLY, {"from": owner})
    contracts["weth"].deposit({"from": owner, "value": owner.balance() / 2})

    return contracts


@pytest.fixture(scope="module")
def setup_protocol(
    deploy_protocol,
    constants,
    devOps,
    owner,
    treasuryAddress,
    protocolReserveAddress,
    UUPS_proxy_deploy_and_initialize,
    TermController,
    TermEventEmitter,
    TermPriceConsumerV3,
    TestPriceFeed,
    TermRepoServicer,
    TermRepoCollateralManager,
    TermRepoToken,
    TermRepoLocker,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
    TermRepoRolloverManager,
    TermInitializer,
):
    contracts = deploy_protocol
    termRepoLocker = contracts["termRepoLocker"]
    termRepoToken = contracts["termRepoToken"]
    termAuctionBidLocker = contracts["termAuctionBidLocker"]
    termAuctionOfferLocker = contracts["termAuctionOfferLocker"]
    auction = contracts["auction"]
    term_repo_servicer = contracts["termRepoServicer"]
    termRepoCollateralManager = contracts["termRepoCollateralManager"]
    rolloverManager = contracts["rolloverManager"]
    rolloverManager2 = contracts["rolloverManager2"]
    termInitializer = contracts["termInitializer"]
    eventEmitter = contracts["eventEmitter"]
    oracle = contracts["oracle"]
    termController = contracts["termController"]

    termRepoLocker.pairTermContracts(
        termRepoCollateralManager.address,
        term_repo_servicer.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )
    termRepoToken.pairTermContracts(
        term_repo_servicer.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionBidLocker.pairTermContracts(
        auction.address,
        term_repo_servicer.address,
        eventEmitter.address,
        termRepoCollateralManager.address,
        oracle.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionOfferLocker.pairTermContracts(
        auction.address,
        eventEmitter.address,
        term_repo_servicer.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    auction.pairTermContracts(
        eventEmitter.address,
        term_repo_servicer.address,
        termAuctionBidLocker.address,
        termAuctionOfferLocker.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "version 1",
        {"from": termInitializer},
    )

    term_repo_servicer.pairTermContracts(
        termRepoLocker.address,
        termRepoCollateralManager.address,
        termRepoToken.address,
        termAuctionOfferLocker.address,
        auction.address,
        rolloverManager.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "version 1",
        {"from": termInitializer},
    )

    termRepoCollateralManager.pairTermContracts(
        termRepoLocker.address,
        term_repo_servicer.address,
        termAuctionBidLocker.address,
        auction.address,
        termController.address,
        oracle.address,
        rolloverManager.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    rolloverManager.pairTermContracts(
        term_repo_servicer.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    # oracle.reOpenToNewTerm(termRepoCollateralManager.address, {"from": owner})
    # oracle.reOpenToNewBidLocker(termAuctionBidLocker.address, {"from": owner})

    # Rollover managers get paired across the two terms repos because they manage rollovers between terms
    termAuctionBidLocker.pairRolloverManager(rolloverManager, {"from": owner})
    termAuctionBidLocker.pairRolloverManager(rolloverManager2, {"from": owner})

    return contracts


# Based on `code/term-temp/scripts/deploy.ts` and `code/term-temp/scripts/deploy-utils.ts`
@pytest.fixture(scope="module")
def deploy_protocol(
    setup_environment,
    owner,
    treasuryAddress,
    protocolReserveAddress,
    controllerAdmin,
    devOps,
    delister,
    UUPS_proxy_deploy_and_initialize,
    TermController,
    TermEventEmitter,
    TermPriceConsumerV3,
    TestPriceFeed,
    TermRepoServicer,
    TermRepoCollateralManager,
    TermRepoToken,
    TermRepoLocker,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
    TermRepoRolloverManager,
    TermInitializer,
):
    contracts = setup_environment
    usdc = contracts["usdc"]  # 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (from mainnet)
    wbtc = contracts["wbtc"]  # 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 (from mainnet)
    weth = contracts["weth"]  # 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 (from mainnet)
    purchaseToken_usdc = usdc
    collateralToken_wbtc = wbtc
    collateralToken_weth = weth
    clearingPricePostProcessingOffset = 1

    # Granting INITIALIZER_APPROVAL_ROLE to owner
    termInitializer = TermInitializer.deploy(owner, devOps, {"from": owner})

    params = [treasuryAddress, protocolReserveAddress, controllerAdmin, devOps]
    termController, _, _ = UUPS_proxy_deploy_and_initialize(TermController, params)

    params = [devOps, delister, termInitializer]
    eventEmitter, _, _ = UUPS_proxy_deploy_and_initialize(TermEventEmitter, params)

    params = [devOps]
    oracle, _, _ = UUPS_proxy_deploy_and_initialize(TermPriceConsumerV3, params)

    decimals = purchaseToken_usdc.decimals()
    description = "Test Price Feed for Purchase Token"
    version = 1
    roundId = 1
    answer = 1 * 10**decimals
    startedAt = chain.time()
    updatedAt = chain.time()
    answeredInRound = 1
    mockPurchaseFeed_usdc = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    description = "Test Price Feed for Collateral Token WBTC"
    answer = 22_104 * 10**decimals
    mockCollateralFeed_wbtc = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    description = "Test Price Feed for Collateral Token WETH"
    answer = 1_548 * 10**decimals
    mockCollateralFeed_weth = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    oracle.addNewTokenPriceFeed(
        collateralToken_wbtc.address, mockCollateralFeed_wbtc.address, {"from": devOps}
    )
    oracle.addNewTokenPriceFeed(
        collateralToken_weth.address, mockCollateralFeed_weth.address, {"from": devOps}
    )
    oracle.addNewTokenPriceFeed(
        purchaseToken_usdc.address, mockPurchaseFeed_usdc.address, {"from": devOps}
    )

    termRepoId = "TestTermRepo"
    maturityTimestamp = chain.time() + 2592000  # 30 days (in s)
    repurchaseWindow = 500 * 86400  # 5 days (in s)
    redemptionBuffer = 300  # 5 minutes (in s)
    servicingFee = 3000000000000000  # 0.3%
    params = [
        termRepoId,
        maturityTimestamp,
        repurchaseWindow,
        redemptionBuffer,
        servicingFee,
        purchaseToken_usdc,
        termController.address,
        eventEmitter,
        termInitializer,
    ]
    term_repo_servicer, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoServicer, params)
    eventEmitter.pairTermContract(term_repo_servicer.address, {"from": termInitializer})
    termController.markTermDeployed(term_repo_servicer.address, {"from": controllerAdmin})

    liquidateDamangesDueToProtocol = 30000000000000000  # 3%
    netExposureCapOnLiquidation = 50000000000000000  # 5%
    deMinimisMarginThreshold = 50 * 10**18
    initialCollateralRatio = 1500000000000000000  # 150%
    maintenanceRatio = 1250000000000000000  # 125%
    liquidatedDamage = 50000000000000000  # 5%

    # struct Collateral {
    #     address tokenAddress;
    #     uint256 initialCollateralRatio;
    #     uint256 maintenanceRatio;
    #     uint256 liquidatedDamage;
    # }
    collateral = (
        collateralToken_wbtc.address,
        initialCollateralRatio,
        maintenanceRatio,
        liquidatedDamage,
    )
    collateral2 = (
        collateralToken_weth.address,
        initialCollateralRatio,
        maintenanceRatio,
        liquidatedDamage,
    )
    collaterals = [collateral, collateral2]

    params = [
        termRepoId,
        liquidateDamangesDueToProtocol,
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        purchaseToken_usdc.address,
        collaterals,
        eventEmitter,
        termInitializer,
    ]
    termRepoCollateralManager, _, _ = UUPS_proxy_deploy_and_initialize(
        TermRepoCollateralManager, params
    )
    termRepoCollateralManager2, _, _ = UUPS_proxy_deploy_and_initialize(
        TermRepoCollateralManager, params
    )
    eventEmitter.pairTermContract(termRepoCollateralManager.address, {"from": termInitializer})
    termController.markTermDeployed(termRepoCollateralManager.address, {"from": controllerAdmin})

    redemptionValue = 1000000000000000000
    mintExposureCap = 1000000000000000000

    # struct TermRepoTokenConfig {
    #     uint256 maturityTimestamp;
    #     address purchaseToken_usdc;
    #     address[] collateralToken_wbtcs;
    #     uint256[] maintenanceCollateralRatios;
    # }
    maintenanceCollateralRatios = [maintenanceRatio, maintenanceRatio]
    collateralToken_wbtcs = [collateralToken_wbtc.address, collateralToken_weth.address]
    config = (
        maturityTimestamp,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        maintenanceCollateralRatios,
    )
    params = [
        termRepoId,
        "TermRepoToken",
        "TESTTF",
        purchaseToken_usdc.decimals(),
        redemptionValue,
        mintExposureCap,
        termInitializer,
        config,
    ]
    termRepoToken, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoToken, params)
    eventEmitter.pairTermContract(termRepoToken.address, {"from": termInitializer})
    termController.markTermDeployed(termRepoToken.address, {"from": controllerAdmin})

    params = [termRepoId, termInitializer]
    termRepoLocker, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoLocker, params)
    eventEmitter.pairTermContract(termRepoLocker.address, {"from": termInitializer})
    termController.markTermDeployed(termRepoLocker.address, {"from": controllerAdmin})

    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60  # -1 min
    auctionRevealDate = chain.time() + 86_400  # +1 day
    auctionEndDate = chain.time() + 600  # +10 mins
    maturityTimestamp = auctionEndDate + 2_592_000  # +30 days
    minimumTenderAmount = 10

    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        maturityTimestamp,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionBidLocker, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    eventEmitter.pairTermContract(termAuctionBidLocker.address, {"from": termInitializer})
    termController.markTermDeployed(termAuctionBidLocker.address, {"from": controllerAdmin})

    params = [
        termRepoId,
        termAuctionId,
        auctionStartDate,
        auctionRevealDate,
        auctionEndDate,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionOfferLocker, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionOfferLocker, params)
    eventEmitter.pairTermContract(termAuctionOfferLocker.address, {"from": termInitializer})
    termController.markTermDeployed(termAuctionOfferLocker.address, {"from": controllerAdmin})

    redemptionTimestamp = maturityTimestamp + repurchaseWindow + redemptionBuffer
    params = [
        termRepoId,
        termAuctionId,
        auctionEndDate,
        auctionEndDate,
        redemptionTimestamp,
        purchaseToken_usdc.address,
        termInitializer,
        clearingPricePostProcessingOffset,
    ]
    auction, _, _ = UUPS_proxy_deploy_and_initialize(TermAuction, params)
    eventEmitter.pairTermContract(auction.address, {"from": termInitializer})
    termController.markTermDeployed(auction.address, {"from": controllerAdmin})

    params = [
        termRepoId,
        term_repo_servicer.address,
        termRepoCollateralManager.address,
        termController.address,
        termInitializer,
    ]
    rolloverManager, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoRolloverManager, params)
    eventEmitter.pairTermContract(rolloverManager.address, {"from": termInitializer})
    termController.markTermDeployed(rolloverManager.address, {"from": controllerAdmin})

    # Set up TermInitializer's other state variables
    termInitializer.pairTermContracts(
        termController,
        eventEmitter,
        oracle,
        {"from": owner},  # owner has INITIALIZER_APPROVAL_ROLE for TermInitializer
    )

    ##########################################################
    # Make a second auction starting after the first matures
    ########################################################
    termRepoId2 = "TestTermRepo2"
    termAuctionId2 = "TestTermAuction2"
    auctionStartDate2 = chain.time() + 3_000_000  # -1 min
    auctionRevealDate2 = auctionStartDate2 + 86_400  # +1 day
    auctionEndDate2 = auctionStartDate2 + 600  # +10 mins
    maturityTimestamp2 = auctionStartDate2 + 2_592_000  # +30 days

    params = [
        termRepoId2,
        maturityTimestamp2,
        repurchaseWindow,
        redemptionBuffer,
        servicingFee,
        purchaseToken_usdc,
        termController.address,
        eventEmitter,
        termInitializer,
    ]
    termRepoServicer2, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoServicer, params)
    termController.markTermDeployed(termRepoServicer2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoServicer2.address, {"from": termInitializer})

    params = [
        termRepoId2,
        liquidateDamangesDueToProtocol,
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        purchaseToken_usdc.address,
        collaterals,
        eventEmitter,
        termInitializer,
    ]
    termRepoCollateralManager2, _, _ = UUPS_proxy_deploy_and_initialize(
        TermRepoCollateralManager, params
    )
    termController.markTermDeployed(termRepoCollateralManager2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoCollateralManager2.address, {"from": termInitializer})

    params = [
        termRepoId2,
        "TermRepoToken2",
        "TESTTF2",
        purchaseToken_usdc.decimals(),
        redemptionValue,
        mintExposureCap,
        termInitializer,
        config,
    ]
    termRepoToken2, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoToken, params)
    eventEmitter.pairTermContract(termRepoToken2.address, {"from": termInitializer})
    termController.markTermDeployed(termRepoToken2.address, {"from": controllerAdmin})

    params = [termRepoId2, termInitializer]
    termRepoLocker2, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoLocker, params)
    termController.markTermDeployed(termRepoLocker2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoLocker2.address, {"from": termInitializer})

    params = [
        termRepoId2,
        termAuctionId2,
        auctionStartDate2,
        auctionRevealDate2,
        auctionEndDate2,
        maturityTimestamp2,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionBidLocker2, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termAuctionBidLocker2.address, {"from": termInitializer})

    params = [
        termRepoId2,
        termAuctionId2,
        auctionStartDate2,
        auctionRevealDate2,
        auctionEndDate2,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionOfferLocker2, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionOfferLocker, params)
    termController.markTermDeployed(termAuctionOfferLocker2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termAuctionOfferLocker2.address, {"from": termInitializer})

    redemptionTimestamp2 = maturityTimestamp2 + repurchaseWindow + redemptionBuffer
    params = [
        termRepoId2,
        termAuctionId2,
        auctionEndDate2,
        auctionEndDate2,
        redemptionTimestamp2,
        purchaseToken_usdc.address,
        termInitializer,
        clearingPricePostProcessingOffset,
    ]
    auction2, _, _ = UUPS_proxy_deploy_and_initialize(TermAuction, params)
    termController.markTermDeployed(auction2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(auction2.address, {"from": termInitializer})

    params = [
        termRepoId2,
        termRepoServicer2.address,
        termRepoCollateralManager2.address,
        termController.address,
        termInitializer.address,
    ]
    rolloverManager2, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoRolloverManager, params)
    termController.markTermDeployed(rolloverManager2.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(rolloverManager2.address, {"from": termInitializer})

    # oracle.reOpenToNewBidLocker(termAuctionBidLocker2.address, {"from": owner})

    termRepoToken2.pairTermContracts(
        termRepoServicer2.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )
    termRepoLocker2.pairTermContracts(
        termRepoCollateralManager2.address,
        termRepoServicer2.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionBidLocker2.pairTermContracts(
        auction2.address,
        termRepoServicer2.address,
        eventEmitter.address,
        termRepoCollateralManager2.address,
        oracle.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionOfferLocker2.pairTermContracts(
        auction2.address,
        eventEmitter.address,
        termRepoServicer2.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    auction2.pairTermContracts(
        eventEmitter.address,
        termRepoServicer2.address,
        termAuctionBidLocker2.address,
        termAuctionOfferLocker2.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "verion 2",
        {"from": termInitializer},
    )

    termRepoServicer2.pairTermContracts(
        termRepoLocker2.address,
        termRepoCollateralManager2.address,
        termRepoToken2.address,
        termAuctionOfferLocker2.address,
        auction2.address,
        rolloverManager2.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "verion 2",
        {"from": termInitializer},
    )

    termRepoCollateralManager2.pairTermContracts(
        termRepoLocker2.address,
        termRepoServicer2.address,
        termAuctionBidLocker2.address,
        auction2.address,
        termController.address,
        oracle.address,
        rolloverManager2.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )
    rolloverManager2.pairTermContracts(
        termRepoServicer2.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    # Rollover managers get paired across the two terms repos because they manage rollovers between terms
    termAuctionBidLocker2.pairRolloverManager(rolloverManager, {"from": owner})
    termAuctionBidLocker2.pairRolloverManager(rolloverManager2, {"from": owner})

    contracts.update(
        {
            "purchaseToken_usdc": purchaseToken_usdc,
            "collateralToken_wbtc": collateralToken_wbtc,
            "collateralToken_weth": collateralToken_weth,
            "termController": termController,
            "eventEmitter": eventEmitter,
            "oracle": oracle,
            "mockPurchaseFeed_usdc": mockPurchaseFeed_usdc,
            "mockCollateralFeed_wbtc": mockCollateralFeed_wbtc,
            "mockCollateralFeed_weth": mockCollateralFeed_weth,
            "termInitializer": termInitializer,
            "auction": auction,
            "termAuctionBidLocker": termAuctionBidLocker,
            "termAuctionOfferLocker": termAuctionOfferLocker,
            "termRepoServicer": term_repo_servicer,
            "termRepoCollateralManager": termRepoCollateralManager,
            "termRepoLocker": termRepoLocker,
            "rolloverManager": rolloverManager,
            "termRepoToken": termRepoToken,
            "auction2": auction2,
            "termAuctionBidLocker2": termAuctionBidLocker2,
            "termAuctionOfferLocker2": termAuctionOfferLocker2,
            "termRepoServicer2": termRepoServicer2,
            "termRepoCollateralManager2": termRepoCollateralManager2,
            "termRepoLocker2": termRepoLocker2,
            "rolloverManager2": rolloverManager2,
            "termRepoToken2": termRepoToken2,
            "maturityTimestamp": maturityTimestamp,
        }
    )
    return contracts

# Similar to deploy_protocol, but to add a third term repo
@pytest.fixture(scope="module")
def protocol_another_auction(
    setup_protocol,
    constants,
    controllerAdmin,
    devOps,
    owner,
    treasuryAddress,
    protocolReserveAddress,
    UUPS_proxy_deploy_and_initialize,
    TermController,
    TermEventEmitter,
    TermPriceConsumerV3,
    TestPriceFeed,
    TermRepoServicer,
    TermRepoCollateralManager,
    TermRepoToken,
    TermRepoLocker,
    TermAuctionBidLocker,
    TermAuctionOfferLocker,
    TermAuction,
    TermRepoRolloverManager,
    TermInitializer,
):
    contracts = setup_protocol
    rolloverManager = contracts["rolloverManager"]
    eventEmitter = contracts["eventEmitter"]
    termInitializer = contracts["termInitializer"]
    termController = contracts["termController"]
    oracle = contracts["oracle"]

    usdc = contracts["usdc"]  # 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 (from mainnet)
    wbtc = contracts["wbtc"]  # 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599 (from mainnet)
    weth = contracts["weth"]  # 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 (from mainnet)
    purchaseToken_usdc = usdc
    collateralToken_wbtc = wbtc
    collateralToken_weth = weth
    clearingPricePostProcessingOffset = 1

    decimals = purchaseToken_usdc.decimals()
    description = "Test Price Feed for Purchase Token"
    version = 1
    roundId = 1
    answer = 1 * 10**decimals
    startedAt = chain.time()
    updatedAt = chain.time()
    answeredInRound = 1
    mockPurchaseFeed_usdc = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    description = "Test Price Feed for Collateral Token WBTC"
    answer = 22_104 * 10**decimals
    mockCollateralFeed_wbtc = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    description = "Test Price Feed for Collateral Token WETH"
    answer = 1_548 * 10**decimals
    mockCollateralFeed_weth = TestPriceFeed.deploy(
        decimals,
        description,
        version,
        roundId,
        answer,
        startedAt,
        updatedAt,
        answeredInRound,
        {"from": owner},
    )

    termRepoId = "TestTermRepo"
    maturityTimestamp = chain.time() + 2592000  # 30 days (in s)
    repurchaseWindow = 500 * 86400  # 5 days (in s)
    redemptionBuffer = 300  # 5 minutes (in s)
    servicingFee = 3000000000000000  # 0.3%

    liquidateDamangesDueToProtocol = 30000000000000000  # 3%
    netExposureCapOnLiquidation = 50000000000000000  # 5%
    deMinimisMarginThreshold = 50 * 10**18
    initialCollateralRatio = 1500000000000000000  # 150%
    maintenanceRatio = 1250000000000000000  # 125%
    liquidatedDamage = 50000000000000000  # 5%

    # struct Collateral {
    #     address tokenAddress;
    #     uint256 initialCollateralRatio;
    #     uint256 maintenanceRatio;
    #     uint256 liquidatedDamage;
    # }
    collateral = (
        collateralToken_wbtc.address,
        initialCollateralRatio,
        maintenanceRatio,
        liquidatedDamage,
    )
    collateral2 = (
        collateralToken_weth.address,
        initialCollateralRatio,
        maintenanceRatio,
        liquidatedDamage,
    )
    collaterals = [collateral, collateral2]

    params = [
        termRepoId,
        liquidateDamangesDueToProtocol,
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        purchaseToken_usdc.address,
        collaterals,
        eventEmitter,
        termInitializer,
    ]
    termRepoCollateralManager3, _, _ = UUPS_proxy_deploy_and_initialize(
        TermRepoCollateralManager, params
    )
    eventEmitter.pairTermContract(termRepoCollateralManager3.address, {"from": termInitializer})

    redemptionValue = 1000000000000000000
    mintExposureCap = 1000000000000000000

    # struct TermRepoTokenConfig {
    #     uint256 maturityTimestamp;
    #     address purchaseToken_usdc;
    #     address[] collateralToken_wbtcs;
    #     uint256[] maintenanceCollateralRatios;
    # }
    maintenanceCollateralRatios = [maintenanceRatio, maintenanceRatio]
    collateralToken_wbtcs = [collateralToken_wbtc.address, collateralToken_weth.address]
    config = (
        maturityTimestamp,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        maintenanceCollateralRatios,
    )
    collateralToken_wbtcs = [collateralToken_wbtc.address, collateralToken_weth.address]

    termAuctionId = "TestTermAuction"
    auctionStartDate = chain.time() - 60  # -1 min
    auctionRevealDate = chain.time() + 86_400  # +1 day
    auctionEndDate = chain.time() + 600  # +10 mins
    maturityTimestamp = auctionEndDate + 2_592_000  # +30 days
    minimumTenderAmount = 10

    ##########################################################
    # Make a third auction with similar config to the second
    ########################################################
    termRepoId3 = "TestTermRepo3"
    termAuctionId3 = "TestTermAuction3"
    auctionStartDate3 = chain.time() + 3_000_000  # -1 min
    auctionRevealDate3 = auctionStartDate3 + 86_400  # +1 day
    auctionEndDate3 = auctionStartDate3 + 600  # +10 mins
    maturityTimestamp3 = auctionStartDate3 + 2_592_000  # +30 days

    params = [
        termRepoId3,
        maturityTimestamp3,
        repurchaseWindow,
        redemptionBuffer,
        servicingFee,
        purchaseToken_usdc,
        termController.address,
        eventEmitter,
        termInitializer,
    ]
    termRepoServicer3, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoServicer, params)
    termController.markTermDeployed(termRepoServicer3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoServicer3.address, {"from": termInitializer})

    params = [
        termRepoId3,
        liquidateDamangesDueToProtocol,
        netExposureCapOnLiquidation,
        deMinimisMarginThreshold,
        purchaseToken_usdc.address,
        collaterals,
        eventEmitter,
        termInitializer,
    ]
    termRepoCollateralManager3, _, _ = UUPS_proxy_deploy_and_initialize(
        TermRepoCollateralManager, params
    )
    termController.markTermDeployed(termRepoCollateralManager3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoCollateralManager3.address, {"from": termInitializer})

    params = [
        termRepoId3,
        "TermRepoToken3",
        "TESTTF3",
        purchaseToken_usdc.decimals(),
        redemptionValue,
        mintExposureCap,
        termInitializer,
        config,
    ]
    termRepoToken3, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoToken, params)
    eventEmitter.pairTermContract(termRepoToken3.address, {"from": termInitializer})
    termController.markTermDeployed(termRepoToken3.address, {"from": controllerAdmin})

    params = [termRepoId3, termInitializer]
    termRepoLocker3, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoLocker, params)
    termController.markTermDeployed(termRepoLocker3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termRepoLocker3.address, {"from": termInitializer})

    params = [
        termRepoId3,
        termAuctionId3,
        auctionStartDate3,
        auctionRevealDate3,
        auctionEndDate3,
        maturityTimestamp3,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionBidLocker3, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionBidLocker, params)
    termController.markTermDeployed(termAuctionBidLocker3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termAuctionBidLocker3.address, {"from": termInitializer})

    params = [
        termRepoId3,
        termAuctionId3,
        auctionStartDate3,
        auctionRevealDate3,
        auctionEndDate3,
        minimumTenderAmount,
        purchaseToken_usdc.address,
        collateralToken_wbtcs,
        termInitializer,
    ]
    termAuctionOfferLocker3, _, _ = UUPS_proxy_deploy_and_initialize(TermAuctionOfferLocker, params)
    termController.markTermDeployed(termAuctionOfferLocker3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(termAuctionOfferLocker3.address, {"from": termInitializer})

    redemptionTimestamp3 = maturityTimestamp3 + repurchaseWindow + redemptionBuffer
    params = [
        termRepoId3,
        termAuctionId3,
        auctionEndDate3,
        auctionEndDate3,
        redemptionTimestamp3,
        purchaseToken_usdc.address,
        termInitializer,
        clearingPricePostProcessingOffset,
    ]
    auction3, _, _ = UUPS_proxy_deploy_and_initialize(TermAuction, params)
    termController.markTermDeployed(auction3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(auction3.address, {"from": termInitializer})

    params = [
        termRepoId3,
        termRepoServicer3.address,
        termRepoCollateralManager3.address,
        termController.address,
        termInitializer.address,
    ]
    rolloverManager3, _, _ = UUPS_proxy_deploy_and_initialize(TermRepoRolloverManager, params)
    termController.markTermDeployed(rolloverManager3.address, {"from": controllerAdmin})
    eventEmitter.pairTermContract(rolloverManager3.address, {"from": termInitializer})

    # oracle.reOpenToNewBidLocker(termAuctionBidLocker3.address, {"from": owner})

    termRepoToken3.pairTermContracts(
        termRepoServicer3.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )
    termRepoLocker3.pairTermContracts(
        termRepoCollateralManager3.address,
        termRepoServicer3.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionBidLocker3.pairTermContracts(
        auction3.address,
        termRepoServicer3.address,
        eventEmitter.address,
        termRepoCollateralManager3.address,
        oracle.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    termAuctionOfferLocker3.pairTermContracts(
        auction3.address,
        eventEmitter.address,
        termRepoServicer3.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    auction3.pairTermContracts(
        eventEmitter.address,
        termRepoServicer3.address,
        termAuctionBidLocker3.address,
        termAuctionOfferLocker3.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "verion 3",
        {"from": termInitializer},
    )

    termRepoServicer3.pairTermContracts(
        termRepoLocker3.address,
        termRepoCollateralManager3.address,
        termRepoToken3.address,
        termAuctionOfferLocker3.address,
        auction3.address,
        rolloverManager3.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        "verion 3",
        {"from": termInitializer},
    )

    termRepoCollateralManager3.pairTermContracts(
        termRepoLocker3.address,
        termRepoServicer3.address,
        termAuctionBidLocker3.address,
        auction3.address,
        termController.address,
        oracle.address,
        rolloverManager3.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )
    rolloverManager3.pairTermContracts(
        termRepoServicer3.address,
        eventEmitter.address,
        devOps,
        owner,  # giving ADMIN_ROLE to owner
        {"from": termInitializer},
    )

    # Rollover managers get paired across the two terms repos because they manage rollovers between terms
    termAuctionBidLocker3.pairRolloverManager(rolloverManager, {"from": owner})
    termAuctionBidLocker3.pairRolloverManager(rolloverManager3, {"from": owner})

    contracts.update(
        {
            "purchaseToken_usdc": purchaseToken_usdc,
            "collateralToken_wbtc": collateralToken_wbtc,
            "collateralToken_weth": collateralToken_weth,
            "termController": termController,
            "eventEmitter": eventEmitter,
            "oracle": oracle,
            "mockPurchaseFeed_usdc": mockPurchaseFeed_usdc,
            "mockCollateralFeed_wbtc": mockCollateralFeed_wbtc,
            "mockCollateralFeed_weth": mockCollateralFeed_weth,
            "termInitializer": termInitializer,
            "auction3": auction3,
            "termAuctionBidLocker3": termAuctionBidLocker3,
            "termAuctionOfferLocker3": termAuctionOfferLocker3,
            "termRepoServicer3": termRepoServicer3,
            "termRepoCollateralManager3": termRepoCollateralManager3,
            "termRepoLocker3": termRepoLocker3,
            "rolloverManager3": rolloverManager3,
            "termRepoToken3": termRepoToken3,
            "maturityTimestamp": maturityTimestamp,
        }
    )
    return contracts