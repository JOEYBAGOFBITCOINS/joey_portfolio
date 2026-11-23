// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControlDefaultAdminRules} from "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";

/// @title B7 Financial simulated gold accounting token
/// @notice Portfolio demonstration only. No real gold, money, custody or redemption rights.
/// @dev A reserve officer supplies trusted SIMULATED quantities. References are audit identifiers,
///      not proofs of physical custody. Invariant: totalSupply() <= confirmedReserveUnits.
contract B7DemoGold is ERC20Pausable, AccessControlDefaultAdminRules {
    uint256 public constant UNITS_PER_GRAM = 1_000_000;
    bytes32 public constant RESERVE_ROLE = keccak256("RESERVE_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant REDEMPTION_ROLE = keccak256("REDEMPTION_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum RedemptionStatus { None, Pending, Approved, Completed, Rejected, Cancelled }

    struct Redemption {
        address owner;
        uint64 requestedAt;
        RedemptionStatus status;
        uint256 units;
        bytes32 requestReference;
    }

    uint256 public confirmedReserveUnits;
    uint256 public escrowedUnits;
    uint256 public nextRedemptionId = 1;
    mapping(bytes32 => bool) public usedReserveReferences;
    mapping(bytes32 => bool) public usedIssuanceReferences;
    // References are scoped to their owner so another holder cannot preempt a public reference.
    mapping(address => mapping(bytes32 => bool)) public usedRedemptionReferences;
    mapping(bytes32 => bool) public usedSettlementReferences;
    mapping(uint256 => Redemption) public redemptions;

    error ZeroAmount();
    error EmptyReference();
    error ReferenceAlreadyUsed(bytes32 referenceId);
    error ReserveBelowSupply(uint256 proposedReserve, uint256 supply);
    error InsufficientReserve(uint256 requested, uint256 available);
    error InvalidRecipient(address recipient);
    error DirectEscrowTransfer();
    error RedemptionNotPending(uint256 redemptionId);
    error RedemptionNotApproved(uint256 redemptionId);
    error RedemptionNotActive(uint256 redemptionId);
    error NotRedemptionOwner(uint256 redemptionId, address caller);

    event ReserveConfirmed(bytes32 indexed confirmationReference, uint256 previousUnits, uint256 confirmedUnits);
    event Issued(bytes32 indexed issuanceReference, address indexed recipient, uint256 units);
    event RedemptionRequested(uint256 indexed redemptionId, address indexed owner, uint256 units, bytes32 requestReference);
    event RedemptionApproved(uint256 indexed redemptionId, address indexed officer);
    event RedemptionCompleted(uint256 indexed redemptionId, bytes32 indexed settlementReference, uint256 units);
    event RedemptionRefunded(uint256 indexed redemptionId, address indexed owner, uint256 units, RedemptionStatus status);

    /// @dev Admin is deliberately NOT granted operational roles. Admin handover is two-step,
    ///      with a one-day delay. Tests use artificial addresses and no private keys.
    constructor(address initialAdmin)
        ERC20("B7 Financial Demo Gold", "B7")
        AccessControlDefaultAdminRules(1 days, initialAdmin)
    {}

    function decimals() public pure override returns (uint8) { return 6; }

    function availableToIssue() public view returns (uint256) {
        return confirmedReserveUnits - totalSupply();
    }

    /// @notice Replace the simulated reserve snapshot. Cannot undercollateralize supply.
    /// @dev A unique reference only prevents replay of an identifier, not dishonest reporting.
    function confirmReserve(uint256 units, bytes32 confirmationReference)
        external onlyRole(RESERVE_ROLE) whenNotPaused
    {
        _consumeReference(usedReserveReferences, confirmationReference);
        if (units < totalSupply()) revert ReserveBelowSupply(units, totalSupply());
        uint256 previous = confirmedReserveUnits;
        confirmedReserveUnits = units;
        emit ReserveConfirmed(confirmationReference, previous, units);
    }

    function issue(address recipient, uint256 units, bytes32 issuanceReference)
        external onlyRole(ISSUER_ROLE) whenNotPaused
    {
        if (units == 0) revert ZeroAmount();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient(recipient);
        _consumeReference(usedIssuanceReferences, issuanceReference);
        uint256 available = availableToIssue();
        if (units > available) revert InsufficientReserve(units, available);
        _mint(recipient, units);
        emit Issued(issuanceReference, recipient, units);
    }

    /// @notice Lock the caller's spendable tokens. No allowance or external callback needed.
    function requestRedemption(uint256 units, bytes32 requestReference)
        external whenNotPaused returns (uint256 redemptionId)
    {
        if (units == 0) revert ZeroAmount();
        _consumeReference(usedRedemptionReferences[_msgSender()], requestReference);
        redemptionId = nextRedemptionId++;
        redemptions[redemptionId] = Redemption({
            owner: _msgSender(),
            requestedAt: uint64(block.timestamp),
            status: RedemptionStatus.Pending,
            units: units,
            requestReference: requestReference
        });
        escrowedUnits += units;
        _transfer(_msgSender(), address(this), units);
        emit RedemptionRequested(redemptionId, _msgSender(), units, requestReference);
    }

    /// @notice Commit a pending request to simulated processing. Owner cancellation ends here.
    function approveRedemption(uint256 redemptionId)
        external onlyRole(REDEMPTION_ROLE) whenNotPaused
    {
        _pending(redemptionId).status = RedemptionStatus.Approved;
        emit RedemptionApproved(redemptionId, _msgSender());
    }

    /// @notice Confirm an approved simulated settlement, burning escrow and reducing reserve equally.
    function completeRedemption(uint256 redemptionId, bytes32 settlementReference)
        external onlyRole(REDEMPTION_ROLE) whenNotPaused
    {
        Redemption storage request = redemptions[redemptionId];
        if (request.status != RedemptionStatus.Approved) revert RedemptionNotApproved(redemptionId);
        _consumeReference(usedSettlementReferences, settlementReference);
        request.status = RedemptionStatus.Completed;
        escrowedUnits -= request.units;
        confirmedReserveUnits -= request.units;
        _burn(address(this), request.units);
        emit RedemptionCompleted(redemptionId, settlementReference, request.units);
    }

    function rejectRedemption(uint256 redemptionId)
        external onlyRole(REDEMPTION_ROLE) whenNotPaused
    {
        Redemption storage request = redemptions[redemptionId];
        if (request.status != RedemptionStatus.Pending && request.status != RedemptionStatus.Approved) {
            revert RedemptionNotActive(redemptionId);
        }
        _refund(redemptionId, request, RedemptionStatus.Rejected);
    }

    function cancelRedemption(uint256 redemptionId) external whenNotPaused {
        Redemption storage request = _pending(redemptionId);
        if (request.owner != _msgSender()) revert NotRedemptionOwner(redemptionId, _msgSender());
        _refund(redemptionId, request, RedemptionStatus.Cancelled);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @dev Only requestRedemption can credit escrow; ordinary transfers cannot strand tokens.
    function transfer(address to, uint256 value) public override returns (bool) {
        if (to == address(this)) revert DirectEscrowTransfer();
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (from == address(this) || to == address(this)) revert DirectEscrowTransfer();
        return super.transferFrom(from, to, value);
    }

    function _pending(uint256 redemptionId) private view returns (Redemption storage request) {
        request = redemptions[redemptionId];
        if (request.status != RedemptionStatus.Pending) revert RedemptionNotPending(redemptionId);
    }

    function _refund(uint256 redemptionId, Redemption storage request, RedemptionStatus status) private {
        request.status = status;
        escrowedUnits -= request.units;
        _transfer(address(this), request.owner, request.units);
        emit RedemptionRefunded(redemptionId, request.owner, request.units, status);
    }

    function _consumeReference(mapping(bytes32 => bool) storage references, bytes32 referenceId) private {
        if (referenceId == bytes32(0)) revert EmptyReference();
        if (references[referenceId]) revert ReferenceAlreadyUsed(referenceId);
        references[referenceId] = true;
    }
}
