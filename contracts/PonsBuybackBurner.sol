// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract PonsBuybackBurner is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    IERC20 public immutable officialPonsToken;
    address public immutable swapRouter;

    event BoughtAndBurned(address indexed inputAsset, uint256 inputAmount, uint256 ponsBurned);

    error Invalid();
    error SwapFailed(bytes reason);
    error RefundFailed();

    constructor(address officialPonsToken_, address swapRouter_) {
        if (officialPonsToken_.code.length == 0 || swapRouter_.code.length == 0) revert Invalid();
        officialPonsToken = IERC20(officialPonsToken_);
        swapRouter = swapRouter_;
    }

    receive() external payable {}

    function buyAndBurnNative(uint256 minimumTokensOut, bytes calldata swapData)
        external payable nonReentrant returns (uint256 bought)
    {
        if (msg.value == 0 || minimumTokensOut == 0 || swapData.length < 4) revert Invalid();
        uint256 beforePons = officialPonsToken.balanceOf(address(this));
        uint256 beforeEth = address(this).balance - msg.value;
        (bool ok, bytes memory reason) = swapRouter.call{value: msg.value}(swapData);
        if (!ok) revert SwapFailed(reason);
        bought = officialPonsToken.balanceOf(address(this)) - beforePons;
        if (bought < minimumTokensOut) revert Invalid();
        officialPonsToken.safeTransfer(BURN_ADDRESS, bought);
        uint256 refund = address(this).balance - beforeEth;
        if (refund != 0) {
            (bool refunded,) = payable(msg.sender).call{value: refund}("");
            if (!refunded) revert RefundFailed();
        }
        emit BoughtAndBurned(address(0), msg.value - refund, bought);
    }

    function buyAndBurnToken(address asset, uint256 amount, uint256 minimumTokensOut, bytes calldata swapData)
        external nonReentrant returns (uint256 bought)
    {
        if (asset.code.length == 0 || asset == address(officialPonsToken) || amount == 0 || minimumTokensOut == 0 || swapData.length < 4) revert Invalid();
        IERC20 input = IERC20(asset);
        uint256 beforeInput = input.balanceOf(address(this));
        uint256 beforePons = officialPonsToken.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amount);
        input.forceApprove(swapRouter, amount);
        (bool ok, bytes memory reason) = swapRouter.call(swapData);
        if (!ok) revert SwapFailed(reason);
        input.forceApprove(swapRouter, 0);
        bought = officialPonsToken.balanceOf(address(this)) - beforePons;
        if (bought < minimumTokensOut) revert Invalid();
        officialPonsToken.safeTransfer(BURN_ADDRESS, bought);
        uint256 refund = input.balanceOf(address(this)) - beforeInput;
        if (refund != 0) input.safeTransfer(msg.sender, refund);
        emit BoughtAndBurned(asset, amount - refund, bought);
    }
}
