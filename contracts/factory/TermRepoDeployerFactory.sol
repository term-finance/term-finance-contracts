//SPDX-License-Identifier: CC-BY-NC-ND-4.0
pragma solidity ^0.8.22;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITermAuctionBidLocker} from "../interfaces/ITermAuctionBidLocker.sol";
import {ITermAuctionOfferLocker} from "../interfaces/ITermAuctionOfferLocker.sol";
import {ITermController} from "../interfaces/ITermController.sol";
import {ITermEventEmitter} from "../interfaces/ITermEventEmitter.sol";
import {TermPriceConsumerV3} from "../TermPriceConsumerV3.sol";
import {TermAuction} from "../TermAuction.sol";
import {TermAuctionBidLocker} from "../TermAuctionBidLocker.sol";
import {TermAuctionOfferLocker} from "../TermAuctionOfferLocker.sol";
import {TermRepoServicer} from "../TermRepoServicer.sol";
import {TermRepoCollateralManager} from "../TermRepoCollateralManager.sol";
import {TermRepoLocker} from "../TermRepoLocker.sol";
import {TermRepoToken} from "../TermRepoToken.sol";
import {TermRepoRolloverManager} from "../TermRepoRolloverManager.sol";
import {ITermRepoServicer} from "../interfaces/ITermRepoServicer.sol";
import {ITermRepoCollateralManager} from "../interfaces/ITermRepoCollateralManager.sol";
import {Collateral} from "../lib/Collateral.sol";
import {TermAuctionGroup} from "../lib/TermAuctionGroup.sol";
import {TermRepoTokenConfig} from "../lib/TermRepoTokenConfig.sol";

/// @author TermLabs
/// @title Term Repo Deployer Factory
/// @notice Factory contract that deploys and initializes a complete set of Term Repo contracts
/// @dev Deploys ERC1967 proxies pointing to pre-deployed implementation contracts, initializes them,
///      registers them with the controller, and wires them together via pairTermContracts calls.
contract TermRepoDeployerFactory is AccessControl {
    // ========================================================================
    // = Errors ===============================================================
    // ========================================================================

    error DeployingPaused();
    error DeployingAuctionsPaused();
    error DeployingTermReposPaused();
    error DuplicateAuctionId(bytes32 auctionId);
    error DuplicateCollateralToken();
    error DuplicateRepoId(bytes32 repoId);
    error EmptyTermAuctionId();
    error EmptyTermRepoId();
    error InvalidAuctionEndTime();
    error InvalidAuctionStartTime();
    error InvalidClearingPricePostProcessingOffset();
    error InvalidInitialCollateralRatio();
    error InvalidLiquidatedDamage();
    error InvalidLiquidatedDamageDueToProtocol();
    error InvalidMaintenanceRatio();
    error InvalidNetExposureCapOnLiquidation();
    error InvalidRevealTime();
    error InvalidTermStartTime();
    error InvalidTokenDecimals();
    error InitialRatioBelowMaintenance();
    error MaturityTimestampInPast();
    error NoAuctionVersion();
    error NoCollateralTokens();
    error NotFactoryDeployed();
    error NoTermVersion();
    error NotTermRepoCollateral();
    error RepoIdMismatch();
    error TermPastMaturity();
    error TokenNotSupportedByOracle();
    error TokenZeroAddress();
    error ZeroAddress();
    error ZeroMinimumTenderAmount();
    error ZeroMintExposureCap();
    error ZeroRepurchaseWindow();

    // ========================================================================
    // = Access Roles =========================================================
    // ========================================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DEVOPS_ROLE = keccak256("DEVOPS_ROLE");

    // ========================================================================
    // = Constants ============================================================
    // ========================================================================

    uint256 public constant REPO_TOKEN_REDEMPTION_VALUE = 1e18; // fixed at 1 purchase token per repo token for simplicity
    uint256 public constant DEMINIMIS_MARGIN_THRESHOLD = 500e18; // $500 USD (1e18 scale); if a borrower's collateral value is within this amount of their repurchase obligation, full liquidation is allowed
    // ========================================================================
    // = State Variables ======================================================
    // ========================================================================

    ITermController public controller;
    ITermEventEmitter public emitter;
    TermPriceConsumerV3 public priceOracle;
    bool public deployingPaused;
    bool public deployingAuctionsPaused;
    bool public deployingTermReposPaused;

    /// @dev Implementation addresses for each repo contract type
    address public termRepoServicerImpl;
    address public termRepoCollateralManagerImpl;
    address public termRepoLockerImpl;
    address public termRepoTokenImpl;
    address public termRepoRolloverManagerImpl;
    string public termVersion;

    /// @dev Implementation addresses for each auction contract type
    address public termAuctionImpl;
    address public termAuctionBidLockerImpl;
    address public termAuctionOfferLockerImpl;
    string public auctionVersion;

    address public immutable admin;
    address public immutable devops;
    address public immutable termDiamond;

    // ========================================================================
    // = Events ===============================================================
    // ========================================================================

    event TermRepoDeployed(
        bytes32 termRepoId,
        address termRepoServicer,
        address termRepoCollateralManager,
        address termRepoLocker,
        address termRepoToken,
        address rolloverManager,
        address deployCaller,
        bool isPermissionlessDeployment,
        string  termRepoIdInputString
    );

    event TermAuctionDeployed(
        bytes32 termRepoId,
        bytes32 termAuctionId,
        address termAuction,
        address termAuctionBidLocker,
        address termAuctionOfferLocker,
        address deployCaller,
        bool isPermissionlessDeployment
    );

    event RepoImplementationsUpdated(
        address termRepoServicerImpl,
        address termRepoCollateralManagerImpl,
        address termRepoLockerImpl,
        address termRepoTokenImpl,
        address termRepoRolloverManagerImpl
    );

    event AuctionImplementationsUpdated(
        address termAuctionImpl,
        address termAuctionBidLockerImpl,
        address termAuctionOfferLockerImpl
    );

    // ========================================================================
    // = Structs ==============================================================
    // ========================================================================

    /// @notice Parameters for deploying a new Term Repo
    struct TermRepoDeployParams {
        // ---- IDs ----
        string termRepoId;
        // ---- Servicer params ----
        uint256 maturityTimestamp;
        uint256 repurchaseWindow;
        uint256 redemptionBuffer;
        address purchaseToken;
        uint256 servicingFee;
        // ---- Collateral Manager params ----
        uint256 netExposureCapOnLiquidation;
        uint256 liquidatedDamagesDueToProtocol;
        Collateral[] collateralTokens;
        // ---- Repo Token params ----
        string tokenName;
        string tokenSymbol;
        uint256 mintExposureCap;
    }

    /// @notice Parameters for deploying a new Term Auction
    struct TermAuctionDeployParams {
        // ---- Common params ----
        string termRepoId;
        string termAuctionId;
        // ---- Timing params ----
        uint256 auctionStartTime;
        uint256 revealTime;
        uint256 auctionEndTime;
        uint256 termStart;
        // ---- Auction config params ----
        uint256 minimumTenderAmount;
        uint256 clearingPricePostProcessingOffset;
    }

    /// @notice Result of a Term Repo deployment
    struct DeployedTermRepo {
        address termRepoServicer;
        address termRepoCollateralManager;
        address termRepoLocker;
        address termRepoToken;
        address rolloverManager;
    }

    /// @notice Result of a Term Auction deployment
    struct DeployedTermAuction {
        address termAuction;
        address termAuctionBidLocker;
        address termAuctionOfferLocker;
    }

    // ========================================================================
    // = Modifiers  ===========================================================
    // ========================================================================

    modifier whileDeployingNotPaused() {
        if (deployingPaused) {
            revert DeployingPaused();
        }
        _;
    }

    modifier whileDeployingAuctionsNotPaused() {
        if (deployingAuctionsPaused) {
            revert DeployingAuctionsPaused();
        }
        _;
    }

    modifier whileDeployingTermReposNotPaused() {
        if (deployingTermReposPaused) {
            revert DeployingTermReposPaused();
        }
        _;
    }

    // ========================================================================
    // = Constructor ==========================================================
    // ========================================================================
    constructor(
        address admin_,
        address devops_,
        ITermController controller_,
        ITermEventEmitter emitter_,
        TermPriceConsumerV3 priceOracle_,
        address termDiamond_
    )  {
        if (admin_ == address(0) ) {
            revert ZeroAddress();
        }
        if (devops_ == address(0) ) {
            revert ZeroAddress();
        }
        if (termDiamond_ == address(0) ) {
            revert ZeroAddress();
        }
        if (address(controller_) == address(0) ) {
            revert ZeroAddress();
        }
        if (address(emitter_) == address(0) ) {
            revert ZeroAddress();
        }
        if (address(priceOracle_) == address(0) ) {
            revert ZeroAddress();
        }
        _grantRole(ADMIN_ROLE, admin_);
        _grantRole(DEVOPS_ROLE, devops_);

        admin = admin_;
        devops = devops_;

        controller = controller_;
        emitter = emitter_;
        priceOracle = priceOracle_;
        termDiamond = termDiamond_;
    }

    // ========================================================================
    // = Admin Functions ======================================================
    // ========================================================================

    /// @notice Update the repo implementation addresses used for proxy deployment
    function setTermRepoImplementations(
        address termRepoServicerImpl_,
        address termRepoCollateralManagerImpl_,
        address termRepoLockerImpl_,
        address termRepoTokenImpl_,
        address termRepoRolloverManagerImpl_,
        string calldata termVersion_
    ) external onlyRole(DEVOPS_ROLE) {
        if (
            termRepoServicerImpl_ == address(0) ||
            termRepoCollateralManagerImpl_ == address(0) ||
            termRepoLockerImpl_ == address(0) ||
            termRepoTokenImpl_ == address(0) ||
            termRepoRolloverManagerImpl_ == address(0)
        ) revert ZeroAddress();

        if (bytes(termVersion_).length == 0) {
            revert NoTermVersion();
        }

        termRepoServicerImpl = termRepoServicerImpl_;
        termRepoCollateralManagerImpl = termRepoCollateralManagerImpl_;
        termRepoLockerImpl = termRepoLockerImpl_;
        termRepoTokenImpl = termRepoTokenImpl_;
        termRepoRolloverManagerImpl = termRepoRolloverManagerImpl_;
        termVersion = termVersion_;

        emit RepoImplementationsUpdated(
            termRepoServicerImpl_,
            termRepoCollateralManagerImpl_,
            termRepoLockerImpl_,
            termRepoTokenImpl_,
            termRepoRolloverManagerImpl_
        );
    }

    /// @notice Update the auction implementation addresses used for proxy deployment
    function setTermAuctionImplementations(
        address termAuctionImpl_,
        address termAuctionBidLockerImpl_,
        address termAuctionOfferLockerImpl_,
        string calldata auctionVersion_
    ) external onlyRole(DEVOPS_ROLE) {
        if (
            termAuctionImpl_ == address(0) ||
            termAuctionBidLockerImpl_ == address(0) ||
            termAuctionOfferLockerImpl_ == address(0)
        ) revert ZeroAddress();

        if (bytes(auctionVersion_).length == 0) {
            revert NoAuctionVersion();
        }

        termAuctionImpl = termAuctionImpl_;
        termAuctionBidLockerImpl = termAuctionBidLockerImpl_;
        termAuctionOfferLockerImpl = termAuctionOfferLockerImpl_;
        auctionVersion = auctionVersion_;

        emit AuctionImplementationsUpdated(
            termAuctionImpl_,
            termAuctionBidLockerImpl_,
            termAuctionOfferLockerImpl_
        );
    }

    /// @notice Update the protocol-level contract references
    function setProtocolContracts(
        ITermController controller_,
        ITermEventEmitter emitter_,
        TermPriceConsumerV3 priceOracle_
    ) external onlyRole(DEVOPS_ROLE) {
        if (address(controller_) == address(0)  || 
            address(emitter_) == address(0)  ||
            address(priceOracle_) == address(0)
        ){
            revert ZeroAddress();
        }
        controller = controller_;
        emitter = emitter_;
        priceOracle = priceOracle_;
    }

    // ========================================================================
    // = Deploy Functions =====================================================
    // ========================================================================

    /// @notice Deploys a complete set of Term Repo contracts, initializes them,
    ///         registers with controller, and wires them together.
    /// @param deployParams Parameters for contract initialization
    /// @return deployed   Addresses of all deployed contracts
    function deployTermRepo(
        TermRepoDeployParams calldata deployParams
    )
        external
        whileDeployingNotPaused
        whileDeployingTermReposNotPaused
        returns (DeployedTermRepo memory deployed)
    {
        _validateRepoDeployParams(deployParams);
        // --- 1. Deploy proxies and initialize ---
        deployed = _deployAndInitializeTermRepo(deployParams);

        // --- 2. Register all contracts with the controller ---
        _registerTermRepoWithController(deployed);

        // --- 3. Pair/wire all contracts together ---
        _pairAllRepoContracts(deployed);

        emit TermRepoDeployed(
            ITermRepoServicer(deployed.termRepoServicer).termRepoId(),
            deployed.termRepoServicer,
            deployed.termRepoCollateralManager,
            deployed.termRepoLocker,
            deployed.termRepoToken,
            deployed.rolloverManager,
            msg.sender,
            true,
            deployParams.termRepoId
        );
    }

    /// @notice Deploys a new Term Auction against an existing Term Repo and reopens it for bidding.
    /// @param auctionDeployParams Parameters for auction contract initialization
    /// @param termRepoServicer    Address of the existing TermRepoServicer to reopen
    /// @return deployed            Addresses of all deployed auction contracts
    function deployAuctionAndReopenTerm(
        TermAuctionDeployParams calldata auctionDeployParams,
        address termRepoServicer
    ) external whileDeployingNotPaused whileDeployingAuctionsNotPaused returns(DeployedTermAuction memory deployed) {
        if (!controller.isFactoryDeployed(termRepoServicer)) {
            revert NotFactoryDeployed();
        }
        if(ITermRepoServicer(termRepoServicer).maturityTimestamp() <= block.timestamp) {
            revert TermPastMaturity();
        }

        _validateAuctionDeployParams(auctionDeployParams, termRepoServicer);
        // --- 1. Deploy proxies and initialize ---
        deployed = _deployAndInitializeTermAuction(auctionDeployParams, termRepoServicer);

        // --- 2. Register all auction contracts with the controller ---
        _registerTermAuctionWithController(deployed);

        // --- 3. Pair auction contracts to each other ---
        _pairAllAuctionContracts(deployed, termRepoServicer);

        // --- 4. Pair auction contracts to Term Repo ---
        _pairAuctionToTerm(
            deployed,
            termRepoServicer
        );

        emit TermAuctionDeployed(
            ITermRepoServicer(termRepoServicer).termRepoId(),
            ITermAuctionBidLocker(deployed.termAuctionBidLocker).termAuctionId(),
            deployed.termAuction,
            deployed.termAuctionBidLocker,
            deployed.termAuctionOfferLocker,
            msg.sender,
            true
        );
    }

    // ========================================================================
    // = Internal: Deploy & Initialize ========================================
    // ========================================================================

    function _deployAndInitializeTermRepo(
        TermRepoDeployParams calldata params
    ) internal returns (DeployedTermRepo memory deployed) {
        // Deploy TermRepoServicer
        deployed.termRepoServicer = _deployProxy(
            termRepoServicerImpl,
            abi.encodeCall(
                TermRepoServicer.initialize,
                (
                    params.termRepoId,
                    params.maturityTimestamp,
                    params.repurchaseWindow,
                    params.redemptionBuffer,
                    params.servicingFee,
                    params.purchaseToken,
                    controller,
                    emitter,
                    address(this) // factory is the initializer
                )
            )
        );

        // Deploy TermRepoCollateralManager
        deployed.termRepoCollateralManager = _deployProxy(
            termRepoCollateralManagerImpl,
            abi.encodeCall(
                TermRepoCollateralManager.initialize,
                (
                    params.termRepoId,
                    params.liquidatedDamagesDueToProtocol,
                    params.netExposureCapOnLiquidation,
                    DEMINIMIS_MARGIN_THRESHOLD,
                    params.purchaseToken,
                    params.collateralTokens,
                    emitter,
                    address(this)
                )
            )
        );

        // Deploy TermRepoLocker
        deployed.termRepoLocker = _deployProxy(
            termRepoLockerImpl,
            abi.encodeCall(
                TermRepoLocker.initialize,
                (params.termRepoId, address(this))
            )
        );

        uint8 purchaseTokenDecimals = IERC20Metadata(params.purchaseToken).decimals();

        // Deploy TermRepoToken
        uint256 redemptionTimestamp = params.maturityTimestamp +
            params.repurchaseWindow +
            params.redemptionBuffer;

        deployed.termRepoToken = _deployProxy(
            termRepoTokenImpl,
            abi.encodeCall(
                TermRepoToken.initialize,
                (
                    params.termRepoId,
                    params.tokenName,
                    params.tokenSymbol,
                    purchaseTokenDecimals,
                    REPO_TOKEN_REDEMPTION_VALUE,
                    params.mintExposureCap,
                    address(this),
                    TermRepoTokenConfig({
                        redemptionTimestamp: redemptionTimestamp,
                        purchaseToken: params.purchaseToken,
                        termRepoServicer: deployed.termRepoServicer,
                        termRepoCollateralManager: deployed
                            .termRepoCollateralManager
                    })
                )
            )
        );

        // Deploy TermRepoRolloverManager
        deployed.rolloverManager = _deployProxy(
            termRepoRolloverManagerImpl,
            abi.encodeCall(
                TermRepoRolloverManager.initialize,
                (
                    params.termRepoId,
                    ITermRepoServicer(deployed.termRepoServicer),
                    ITermRepoCollateralManager(
                        deployed.termRepoCollateralManager
                    ),
                    controller,
                    address(this)
                )
            )
        );
    }

     function _deployAndInitializeTermAuction(
        TermAuctionDeployParams calldata params,
        address termRepoServicer
    ) internal returns (DeployedTermAuction memory deployed) {
        ITermRepoServicer servicer = ITermRepoServicer(termRepoServicer);
        uint256 redemptionTimestamp = servicer.redemptionTimestamp();
        address purchaseToken = servicer.purchaseToken();

        ITermRepoCollateralManager collateralManager = servicer.termRepoCollateralManager();
        
        IERC20[] memory collateralTokens = new IERC20[](collateralManager.numOfAcceptedCollateralTokens());
        for (uint8 i = 0; i < collateralTokens.length; i++) {
            collateralTokens[i] = IERC20(collateralManager.collateralTokens(i));
        }

        // Deploy TermAuctionBidLocker
        deployed.termAuctionBidLocker = _deployProxy(
            termAuctionBidLockerImpl,
            abi.encodeCall(
                TermAuctionBidLocker.initialize,
                (
                    params.termRepoId,
                    params.termAuctionId,
                    params.auctionStartTime,
                    params.revealTime,
                    params.auctionEndTime,
                    redemptionTimestamp,
                    params.minimumTenderAmount,
                    purchaseToken,
                    collateralTokens,
                    address(this) // factory is the initializer
                )
            )
        );

        // Deploy TermAuctionOfferLocker
        deployed.termAuctionOfferLocker = _deployProxy(
            termAuctionOfferLockerImpl,
            abi.encodeCall(
                TermAuctionOfferLocker.initialize,
                (
                    params.termRepoId,
                    params.termAuctionId,
                    params.auctionStartTime,
                    params.revealTime,
                    params.auctionEndTime,
                    params.minimumTenderAmount,
                    IERC20(purchaseToken),
                    collateralTokens,
                    address(this) // factory is the initializer
                )
            )
        );

        //Deploy TermAuction
        deployed.termAuction = _deployProxy(
            termAuctionImpl,
            abi.encodeCall(
                TermAuction.initialize,
                (
                    params.termRepoId,
                    params.termAuctionId,
                    params.auctionEndTime,
                    params.termStart,
                    redemptionTimestamp,
                    IERC20Metadata(purchaseToken),
                    address(this),
                    params.clearingPricePostProcessingOffset
                )
            )
        );
                    
    }

    // ========================================================================
    // = Internal: Controller Registration ====================================
    // ========================================================================

    function _registerTermRepoWithController(
        DeployedTermRepo memory deployed
    ) internal {
        controller.markTermFactoryDeployed(deployed.termRepoServicer);
        controller.markTermFactoryDeployed(deployed.termRepoCollateralManager);
        controller.markTermFactoryDeployed(deployed.termRepoLocker);
        controller.markTermFactoryDeployed(deployed.termRepoToken);
        controller.markTermFactoryDeployed(deployed.rolloverManager);
        controller.registerRepoId(ITermRepoServicer(deployed.termRepoServicer).termRepoId());
    }

    function _registerTermAuctionWithController(
        DeployedTermAuction memory deployed
    ) internal {
        controller.markTermFactoryDeployed(deployed.termAuction);
        controller.markTermFactoryDeployed(deployed.termAuctionBidLocker);
        controller.markTermFactoryDeployed(deployed.termAuctionOfferLocker);
        controller.registerAuctionId(ITermAuctionBidLocker(deployed.termAuctionBidLocker).termAuctionId());
    }

    // ========================================================================
    // = Internal: Pair/Wire Contracts ========================================
    // ========================================================================

    function _pairAllRepoContracts(
        DeployedTermRepo memory deployed
    ) internal {
        // -- Pair TermRepoLocker --
        emitter.pairTermContract(deployed.termRepoLocker);
        TermRepoLocker(deployed.termRepoLocker).pairTermContracts(
            deployed.termRepoCollateralManager,
            deployed.termRepoServicer,
            emitter,
            devops,
            admin
        );

        // -- Pair TermRepoToken --
        emitter.pairTermContract(deployed.termRepoToken);
        TermRepoToken(deployed.termRepoToken).pairTermContracts(
            deployed.termRepoServicer,
            emitter,
            devops,
            admin
        );

        // -- Pair TermRepoServicer --
        // NOTE: auction/offerLocker/termDiamond addresses must be set later when an auction is deployed
        emitter.pairTermContract(deployed.termRepoServicer);
        TermRepoServicer(deployed.termRepoServicer).pairTermContracts(
            deployed.termRepoLocker,
            deployed.termRepoCollateralManager,
            deployed.termRepoToken,
            termDiamond,
            address(0), // termAuctionOfferLocker - set when auction deployed
            address(0), // termAuction - set when auction deployed
            deployed.rolloverManager,
            devops,
            address(this),
            termVersion
        );

        // -- Pair TermRepoCollateralManager --
        emitter.pairTermContract(deployed.termRepoCollateralManager);
        TermRepoCollateralManager(deployed.termRepoCollateralManager)
            .pairTermContracts(
                deployed.termRepoLocker,
                deployed.termRepoServicer,
                address(0), // termAuctionBidLocker - set when auction deployed
                address(0), // termAuction - set when auction deployed
                address(controller),
                address(priceOracle),
                deployed.rolloverManager,
                termDiamond,
                devops,
                admin
            );

        // -- Pair TermRepoRolloverManager --
        emitter.pairTermContract(deployed.rolloverManager);
        TermRepoRolloverManager(deployed.rolloverManager).pairTermContracts(
            deployed.termRepoServicer,
            termDiamond,
            emitter,
            devops,
            admin
        );
    }

    function _pairAllAuctionContracts(
        DeployedTermAuction memory deployed,
        address termRepoServicer
    ) internal {
        ITermRepoServicer servicer = ITermRepoServicer(termRepoServicer);
        ITermRepoCollateralManager collateralManager = ITermRepoCollateralManager(
            servicer.termRepoCollateralManager()
        );

        controller.pairAuction(deployed.termAuction);

        // -- Pair TermAuctionBidLocker --
        emitter.pairTermContract(deployed.termAuctionBidLocker);
        TermAuctionBidLocker(deployed.termAuctionBidLocker).pairTermContracts(
            deployed.termAuction,
            servicer,
            emitter,
            collateralManager,
            priceOracle,
            devops,
            admin,
            termDiamond
        );

        // -- Pair TermAuctionOfferLocker --
        emitter.pairTermContract(deployed.termAuctionOfferLocker);
        TermAuctionOfferLocker(deployed.termAuctionOfferLocker).pairTermContracts(
            deployed.termAuction,
            emitter,
            servicer,
            devops,
            admin,
            termDiamond
        );

        // -- Pair TermAuction --
        emitter.pairTermContract(deployed.termAuction);
        TermAuction(deployed.termAuction).pairTermContracts(
            emitter,
            controller,
            servicer,
            ITermAuctionBidLocker(deployed.termAuctionBidLocker),
            ITermAuctionOfferLocker(deployed.termAuctionOfferLocker),
            devops,
            admin,
            address(this),
            auctionVersion
        );
    }

    function _pairAuctionToTerm(
        DeployedTermAuction memory deployed,
        address termRepoServicer
    ) internal {
        TermAuctionGroup memory auctionGroup = TermAuctionGroup({
            auction: TermAuction(deployed.termAuction),
            termAuctionBidLocker: ITermAuctionBidLocker(deployed.termAuctionBidLocker),
            termAuctionOfferLocker: ITermAuctionOfferLocker(deployed.termAuctionOfferLocker)
        });
        TermRepoServicer servicer = TermRepoServicer(termRepoServicer);

        TermRepoCollateralManager collateralManager = TermRepoCollateralManager(
            address(servicer.termRepoCollateralManager())
        );
        collateralManager.reopenToNewAuction(auctionGroup);

        servicer.reopenToNewAuction(auctionGroup);
    }

    function _validateRepoDeployParams(TermRepoDeployParams calldata params) internal view {
        if (bytes(params.termRepoId).length == 0) {
            revert EmptyTermRepoId();
        }
        bytes32 termRepoIdHash = keccak256(abi.encodePacked(params.termRepoId));
        if (controller.registeredRepoIds(termRepoIdHash)) {
            revert DuplicateRepoId(termRepoIdHash);
        }
        if (params.maturityTimestamp <= block.timestamp) {
            revert MaturityTimestampInPast();
        }
        if (params.repurchaseWindow == 0) {
            revert ZeroRepurchaseWindow();
        }
        if (params.mintExposureCap == 0) {
            revert ZeroMintExposureCap();
        }

        if (params.netExposureCapOnLiquidation <= 1e16) {
            revert InvalidNetExposureCapOnLiquidation();
        }

        _validateToken(params.purchaseToken);
        if(params.collateralTokens.length == 0) {
            revert NoCollateralTokens();
        }
        address[] memory seen = new address[](params.collateralTokens.length);
        uint256 j;
        for (uint256 i = 0; i < params.collateralTokens.length; i++) {
            address token = params.collateralTokens[i].tokenAddress;
            for (j = 0; j < i; j++) {
                if (seen[j] == token) {
                    revert DuplicateCollateralToken();
                }
            }
            seen[i] = token;
            _validateToken(token);
            if (params.collateralTokens[i].maintenanceRatio == 0) {
                revert InvalidMaintenanceRatio();
            }
            if (params.collateralTokens[i].initialCollateralRatio == 0) {
                revert InvalidInitialCollateralRatio();
            } 
            if (params.collateralTokens[i].initialCollateralRatio < params.collateralTokens[i].maintenanceRatio) {
                revert InitialRatioBelowMaintenance();
            }
            if (params.collateralTokens[i].liquidatedDamage == 0) {
                revert InvalidLiquidatedDamage();
            }
            if (params.collateralTokens[i].liquidatedDamage <= params.liquidatedDamagesDueToProtocol) {
                revert InvalidLiquidatedDamageDueToProtocol();
            }
        }
    }

    function _validateAuctionDeployParams(TermAuctionDeployParams calldata params, address termRepoServicer) internal view {
        if (bytes(params.termRepoId).length == 0) {
            revert EmptyTermRepoId();
        }

        ITermRepoServicer servicer = ITermRepoServicer(termRepoServicer);
        bytes32 servicerRepoId = servicer.termRepoId();
        bytes32 termRepoIdHash = keccak256(abi.encodePacked(params.termRepoId));
        if (termRepoIdHash != servicerRepoId) {
            revert RepoIdMismatch();
        }

        if (bytes(params.termAuctionId).length == 0) {
            revert EmptyTermAuctionId();
        }

        bytes32 termAuctionIdHash = keccak256(abi.encodePacked(params.termAuctionId));
        if (controller.registeredAuctionIds(termAuctionIdHash)) {
            revert DuplicateAuctionId(termAuctionIdHash);
        }

        if (params.auctionStartTime < block.timestamp) {
            revert InvalidAuctionStartTime();
        }
        if (params.revealTime <= params.auctionStartTime) {
            revert InvalidRevealTime();
        }
        if (params.auctionEndTime < params.revealTime) {
            revert InvalidAuctionEndTime();
        }
        if (params.termStart < params.auctionEndTime) {
            revert InvalidTermStartTime();
        }
        if (params.termStart >= servicer.maturityTimestamp()) {
            revert InvalidTermStartTime();
        }
        if (params.minimumTenderAmount == 0) {
            revert ZeroMinimumTenderAmount();
        }
        if (params.clearingPricePostProcessingOffset != 0 && params.clearingPricePostProcessingOffset != 1) {
            revert InvalidClearingPricePostProcessingOffset();
        }
    }

    function _validateToken(
        address token
    ) internal view {
        if (token == address(0)) {
            revert TokenZeroAddress();
        }
        uint8 decimals;
        try IERC20Metadata(token).decimals() returns (uint8 d) {
            decimals = d;
        } catch {
            revert InvalidTokenDecimals();
        }
        if (decimals > 18) {
            revert InvalidTokenDecimals();
        }
        _validateTokenOraclePrice(token, decimals);
    }

    function _validateTokenOraclePrice(
        address token,
        uint8 decimals
    ) internal view {
        try priceOracle.usdValueOfTokens(token, 10 ** decimals) {
            // ok
        } catch {
            revert TokenNotSupportedByOracle();
        }
    }
        

    // ========================================================================
    // = Internal: Proxy Deployment ===========================================
    // ========================================================================

    /// @dev Deploys an ERC1967 proxy pointing to `impl`, calling `initData` on construction.
    function _deployProxy(
        address impl,
        bytes memory initData
    ) internal returns (address) {
        if (impl == address(0)) revert ZeroAddress();
        ERC1967Proxy proxy = new ERC1967Proxy(impl, initData);
        return address(proxy);
    }

    // ========================================================================
    // = Pause Functions ======================================================
    // ========================================================================

    function pauseDeploying() external onlyRole(ADMIN_ROLE) {
        deployingPaused = true;
    }

    function unpauseDeploying() external onlyRole(ADMIN_ROLE) {
        deployingPaused = false;
    }

    function pauseAuctionDeploys() external onlyRole(ADMIN_ROLE) {
        deployingAuctionsPaused = true;
    }

    function unpauseAuctionDeploys() external onlyRole(ADMIN_ROLE) {
        deployingAuctionsPaused = false;
    }

    function pauseTermRepoDeploys() external onlyRole(ADMIN_ROLE) {
        deployingTermReposPaused = true;
    }

    function unpauseTermRepoDeploys() external onlyRole(ADMIN_ROLE) {
        deployingTermReposPaused = false;
    }
}
