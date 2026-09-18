// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IPonsCreatorFeeEscrow {
    function claim() external returns (uint256 amount);
    function claimToken(address token) external;
}

interface ICreatorVaultFactory {
    function attestor() external view returns (address);
    function buybackBurner() external view returns (address);
    function developmentTreasury() external view returns (address payable);
    function buybackTreasury() external view returns (address payable);
}

interface IPonsBuybackBurner {
    function buyAndBurnNative(uint256 minimumTokensOut, bytes calldata swapData) external payable returns (uint256);
    function buyAndBurnToken(address asset, uint256 amount, uint256 minimumTokensOut, bytes calldata swapData) external returns (uint256);
}

contract CreatorFeeVault is ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant CLAIM_WINDOW = 48 hours;
    uint256 public constant BPS = 10_000;
    uint256 public constant CREATOR_SHARE_BPS = 8_000;
    uint256 public constant CLAIM_BURN_BPS = 2_000;
    uint256 public constant EXPIRED_DEVELOPMENT_BPS = 5_000;
    bytes32 public constant CLAIM_AUTHORIZATION_TYPEHASH = keccak256(
        "ClaimAuthorization(address vault,bytes32 executionHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WITHDRAW_AUTHORIZATION_TYPEHASH = keccak256(
        "WithdrawAuthorization(address vault,address asset,uint256 amount,address recipient,uint256 nonce,uint256 deadline)"
    );

    struct Lot {
        address asset;
        uint128 amount;
        uint64 claimDeadline;
        bool settled;
    }

    bytes32 public immutable launchKey;
    bytes32 public immutable creatorRouteKey;
    ICreatorVaultFactory public immutable factory;
    IPonsCreatorFeeEscrow public immutable feeEscrow;
    uint256 public nextLotId = 1;
    mapping(uint256 lotId => Lot lot) public lots;
    mapping(uint256 nonce => bool used) public usedAuthorizationNonce;
    mapping(address asset => uint256 amount) public creatorBalances;

    event LotCreated(uint256 indexed lotId, address indexed asset, uint256 amount, uint256 claimDeadline);
    event LotClaimed(uint256 indexed lotId, address indexed asset, uint256 creatorAmount, uint256 burnAmount);
    event CreatorWithdrawal(address indexed asset, address indexed recipient, uint256 amount);
    event LotExpired(uint256 indexed lotId, uint256 developmentAmount, uint256 burnAmount);
    event BuybackAllocation(uint256 indexed lotId, address indexed asset, uint256 amount, address indexed treasury);

    error Invalid();
    error Unauthorized();
    error NotClaimable();
    error TransferFailed();

    constructor(bytes32 launchKey_, bytes32 creatorRouteKey_, address factory_, address feeEscrow_) EIP712("PONSPAY", "1") {
        if (launchKey_ == bytes32(0) || creatorRouteKey_ == bytes32(0) || factory_.code.length == 0 || feeEscrow_.code.length == 0) revert Invalid();
        launchKey = launchKey_;
        creatorRouteKey = creatorRouteKey_;
        factory = ICreatorVaultFactory(factory_);
        feeEscrow = IPonsCreatorFeeEscrow(feeEscrow_);
    }

    receive() external payable {}

    function routesBuybackToTreasury() external pure returns (bool) { return true; }

    function collectNative() external nonReentrant returns (uint256 lotId, uint256 received) {
        uint256 beforeBalance = address(this).balance;
        feeEscrow.claim();
        received = address(this).balance - beforeBalance;
        lotId = _createLot(address(0), received);
    }

    function collectToken(address asset) external nonReentrant returns (uint256 lotId, uint256 received) {
        if (asset.code.length == 0) revert Invalid();
        uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
        feeEscrow.claimToken(asset);
        received = IERC20(asset).balanceOf(address(this)) - beforeBalance;
        lotId = _createLot(asset, received);
    }

    function claim(
        uint256[] calldata lotIds,
        uint256[] calldata minimumBurnTokensOut,
        bytes[] calldata swapData,
        uint256 nonce,
        uint256 authorizationDeadline,
        bytes calldata authorization
    ) external nonReentrant {
        uint256 length = lotIds.length;
        if (length == 0 || length != minimumBurnTokensOut.length || length != swapData.length) revert Invalid();
        bytes32 executionHash = keccak256(abi.encode(lotIds, minimumBurnTokensOut, swapData));
        _authorizeClaim(executionHash, nonce, authorizationDeadline, authorization);
        for (uint256 i; i < length; ++i) {
            _claimLot(lotIds[i], minimumBurnTokensOut[i], swapData[i]);
        }
    }

    function withdraw(
        address asset,
        uint256 amount,
        address payable recipient,
        uint256 nonce,
        uint256 authorizationDeadline,
        bytes calldata authorization
    ) external nonReentrant {
        if (recipient == address(0) || amount == 0 || creatorBalances[asset] < amount) revert Invalid();
        _authorizeWithdrawal(asset, amount, recipient, nonce, authorizationDeadline, authorization);
        creatorBalances[asset] -= amount;
        _transfer(asset, recipient, amount);
        emit CreatorWithdrawal(asset, recipient, amount);
    }

    function expire(uint256[] calldata lotIds, uint256[] calldata minimumBurnTokensOut, bytes[] calldata swapData)
        external nonReentrant
    {
        uint256 length = lotIds.length;
        if (length == 0 || length != minimumBurnTokensOut.length || length != swapData.length) revert Invalid();
        address payable treasury = factory.developmentTreasury();
        for (uint256 i; i < length; ++i) {
            _expireLot(lotIds[i], minimumBurnTokensOut[i], swapData[i], treasury);
        }
    }

    function _claimLot(uint256 lotId, uint256 minimumOut, bytes calldata data) internal {
        Lot storage lot = lots[lotId];
        if (lot.settled || lot.amount == 0 || block.timestamp > lot.claimDeadline) revert NotClaimable();
        lot.settled = true;
        uint256 creatorAmount = uint256(lot.amount) * CREATOR_SHARE_BPS / BPS;
        uint256 burnAmount = uint256(lot.amount) - creatorAmount;
        address payable treasury = factory.buybackTreasury();
        _transfer(lot.asset, treasury, burnAmount);
        creatorBalances[lot.asset] += creatorAmount;
        emit BuybackAllocation(lotId, lot.asset, burnAmount, treasury);
        emit LotClaimed(lotId, lot.asset, creatorAmount, burnAmount);
    }

    function _expireLot(uint256 lotId, uint256 minimumOut, bytes calldata data, address payable treasury) internal {
        Lot storage lot = lots[lotId];
        if (lot.settled || lot.amount == 0 || block.timestamp <= lot.claimDeadline) revert NotClaimable();
        lot.settled = true;
        uint256 developmentAmount = uint256(lot.amount) * EXPIRED_DEVELOPMENT_BPS / BPS;
        uint256 burnAmount = uint256(lot.amount) - developmentAmount;
        _buyAndBurn(lot.asset, burnAmount, minimumOut, data);
        _transfer(lot.asset, treasury, developmentAmount);
        emit LotExpired(lotId, developmentAmount, burnAmount);
    }

    function _createLot(address asset, uint256 amount) internal returns (uint256 lotId) {
        if (amount == 0 || amount > type(uint128).max) revert Invalid();
        lotId = nextLotId++;
        uint256 deadline = block.timestamp + CLAIM_WINDOW;
        lots[lotId] = Lot({asset: asset, amount: uint128(amount), claimDeadline: uint64(deadline), settled: false});
        emit LotCreated(lotId, asset, amount, deadline);
    }

    function _authorizeClaim(bytes32 executionHash, uint256 nonce, uint256 deadline, bytes calldata signature) internal {
        if (block.timestamp > deadline || usedAuthorizationNonce[nonce]) revert Unauthorized();
        bytes32 structHash = keccak256(abi.encode(CLAIM_AUTHORIZATION_TYPEHASH, address(this), executionHash, nonce, deadline));
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != factory.attestor()) revert Unauthorized();
        usedAuthorizationNonce[nonce] = true;
    }

    function _authorizeWithdrawal(
        address asset,
        uint256 amount,
        address recipient,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) internal {
        if (block.timestamp > deadline || usedAuthorizationNonce[nonce]) revert Unauthorized();
        bytes32 structHash = keccak256(
            abi.encode(WITHDRAW_AUTHORIZATION_TYPEHASH, address(this), asset, amount, recipient, nonce, deadline)
        );
        address signer = ECDSA.recover(_hashTypedDataV4(structHash), signature);
        if (signer != factory.attestor()) revert Unauthorized();
        usedAuthorizationNonce[nonce] = true;
    }

    function _buyAndBurn(address asset, uint256 amount, uint256 minimumOut, bytes calldata data) internal {
        if (amount == 0 || minimumOut == 0 || data.length < 4) revert Invalid();
        IPonsBuybackBurner burner = IPonsBuybackBurner(factory.buybackBurner());
        if (asset == address(0)) {
            burner.buyAndBurnNative{value: amount}(minimumOut, data);
        } else {
            IERC20(asset).forceApprove(address(burner), amount);
            burner.buyAndBurnToken(asset, amount, minimumOut, data);
            IERC20(asset).forceApprove(address(burner), 0);
        }
    }

    function _transfer(address asset, address payable recipient, uint256 amount) internal {
        if (asset == address(0)) {
            (bool sent,) = recipient.call{value: amount}("");
            if (!sent) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }
}
