// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address recipient, uint256 amount) external { _mint(recipient, amount); }
}

contract MockFeeEscrow {
    using SafeERC20 for IERC20;
    mapping(address => uint256) public nativeBalance;
    mapping(address => mapping(address => uint256)) public tokenBalance;

    function fundToken(address recipient, address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenBalance[recipient][token] += amount;
    }

    function claim() external returns (uint256 amount) {
        amount = nativeBalance[msg.sender];
        nativeBalance[msg.sender] = 0;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        require(sent);
    }

    function claimToken(address token) external {
        uint256 amount = tokenBalance[msg.sender][token];
        tokenBalance[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}

contract MockSwapRouter {
    using SafeERC20 for IERC20;
    IERC20 public immutable officialToken;
    constructor(address officialToken_) { officialToken = IERC20(officialToken_); }
    function swapToken(address asset, uint256 amount) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        officialToken.safeTransfer(msg.sender, amount);
    }
}
