// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CreatorFeeVault} from "./CreatorFeeVault.sol";

contract CreatorFeeVaultFactory is Ownable2Step {
    address public immutable feeEscrow;
    address public attestor;
    address public vaultCreator;
    address public buybackBurner;
    address payable public immutable buybackTreasury;
    address payable public developmentTreasury;
    mapping(bytes32 launchKey => address vault) public vaultOfLaunch;

    event VaultCreated(bytes32 indexed launchKey, bytes32 indexed creatorRouteKey, address indexed vault);
    event AttestorUpdated(address indexed previousValue, address indexed newValue);
    event VaultCreatorUpdated(address indexed previousValue, address indexed newValue);
    event BuybackBurnerUpdated(address indexed previousValue, address indexed newValue);
    event DevelopmentTreasuryUpdated(address indexed previousValue, address indexed newValue);

    error InvalidAddress();
    error InvalidLaunchKey();
    error VaultAlreadyExists();
    error Unauthorized();

    constructor(address owner_, address feeEscrow_, address attestor_, address vaultCreator_, address burner_, address payable treasury_, address payable buybackTreasury_)
        Ownable(owner_)
    {
        if (feeEscrow_.code.length == 0 || attestor_ == address(0) || vaultCreator_ == address(0) || burner_.code.length == 0 || treasury_ == address(0) || buybackTreasury_ == address(0)) {
            revert InvalidAddress();
        }
        feeEscrow = feeEscrow_;
        attestor = attestor_;
        vaultCreator = vaultCreator_;
        buybackBurner = burner_;
        developmentTreasury = treasury_;
        buybackTreasury = buybackTreasury_;
    }

    function createVault(bytes32 launchKey, bytes32 creatorRouteKey) external returns (address vault) {
        if (msg.sender != owner() && msg.sender != vaultCreator) revert Unauthorized();
        vault = _createVault(launchKey, creatorRouteKey);
    }

    function createVaultForLauncher(bytes32 launchKey, bytes32 creatorRouteKey, bytes32 launcherSalt) external returns (address vault) {
        bytes32 expected = keccak256(abi.encodePacked("PONSPAY_LAUNCH", creatorRouteKey, msg.sender, launcherSalt));
        if (launchKey != expected) revert InvalidLaunchKey();
        vault = _createVault(launchKey, creatorRouteKey);
    }

    function _createVault(bytes32 launchKey, bytes32 creatorRouteKey) internal returns (address vault) {
        if (launchKey == bytes32(0) || creatorRouteKey == bytes32(0)) revert InvalidAddress();
        if (vaultOfLaunch[launchKey] != address(0)) revert VaultAlreadyExists();
        vault = address(new CreatorFeeVault{salt: launchKey}(launchKey, creatorRouteKey, address(this), feeEscrow));
        vaultOfLaunch[launchKey] = vault;
        emit VaultCreated(launchKey, creatorRouteKey, vault);
    }

    function predictVault(bytes32 launchKey, bytes32 creatorRouteKey) external view returns (address predicted) {
        bytes memory creation = abi.encodePacked(
            type(CreatorFeeVault).creationCode,
            abi.encode(launchKey, creatorRouteKey, address(this), feeEscrow)
        );
        bytes32 hash = keccak256(creation);
        predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), launchKey, hash)))));
    }

    function setAttestor(address value) external onlyOwner {
        if (value == address(0)) revert InvalidAddress();
        emit AttestorUpdated(attestor, value);
        attestor = value;
    }

    function setVaultCreator(address value) external onlyOwner {
        if (value == address(0)) revert InvalidAddress();
        emit VaultCreatorUpdated(vaultCreator, value);
        vaultCreator = value;
    }

    function setBuybackBurner(address value) external onlyOwner {
        if (value.code.length == 0) revert InvalidAddress();
        emit BuybackBurnerUpdated(buybackBurner, value);
        buybackBurner = value;
    }

    function setDevelopmentTreasury(address payable value) external onlyOwner {
        if (value == address(0)) revert InvalidAddress();
        emit DevelopmentTreasuryUpdated(developmentTreasury, value);
        developmentTreasury = value;
    }
}
