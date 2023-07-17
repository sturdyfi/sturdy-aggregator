// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {SturdyERC4626} from './SturdyERC4626.sol';
import {SturdyERC20} from './SturdyERC20.sol';
import {Errors} from '../libraries/Errors.sol';
import {IERC20} from '../interfaces/IERC20.sol';
import {SafeERC20} from '../libraries/SafeERC20.sol';
import {ReentrancyGuard} from '../dependencies/ReentrancyGuard.sol';
import {IERC20Detailed} from '../interfaces/IERC20Detailed.sol';
import {IGenericLender} from '../interfaces/IGenericLender.sol';
import {VersionedInitializable} from '../dependencies/VersionedInitializable.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';

contract Aggregator is VersionedInitializable, SturdyERC4626, ReentrancyGuard {
  using SafeERC20 for IERC20;

  struct lenderRatio {
    address lender;
    //share x 1000
    uint16 share;
  }

  uint256 private constant REVISION = 0x1;

  address internal admin;
  address[] internal lenders;

  // lender -> supplyCap
  mapping(address => uint256) internal supplyCaps;

  bool internal active;
  ILendingPoolAddressesProvider internal _addressesProvider;

  event UpdatedAdmin(address admin);

  modifier onlyAdmin() {
    require(msg.sender == admin || msg.sender == _addressesProvider.getPoolAdmin(), Errors.AG_CALLER_NOT_ADMIN);
    _;
  }

  constructor(IERC20Detailed asset_) SturdyERC4626(asset_) SturdyERC20('', '', 18) {}

  /**
   * @dev Function is invoked by the proxy contract when this contract is deployed.
   * - Caller is initializer (LendingPoolAddressesProvider or deployer)
   * @param _provider The address of the provider
   **/
  function initialize(ILendingPoolAddressesProvider _provider) external initializer {
    _addressesProvider = _provider;
  }

  function getRevision() internal pure override returns (uint256) {
    return REVISION;
  }

  /**
   * @dev init the lptoken name and symbol
   * - Caller is Admin
   * @param _name - The lptoken name
   * @param _symbol - The lptoken symbol
   * @param decimals The lp token decimals
   */
  function init(
    string memory _name,
    string memory _symbol,
    uint8 decimals
  ) external payable onlyAdmin {
    _setName(_name);
    _setSymbol(_symbol);
    _setDecimals(decimals);
  }

  /**
   * @dev Set the admin address.
   * - Caller is Admin
   * @param _admin The address of admin.
   */
  function setAdmin(address _admin) external payable onlyAdmin {
    require(_admin != address(0), Errors.AG_INVALID_CONFIGURATION);
    admin = _admin;

    emit UpdatedAdmin(_admin);
  }

  /**
   * @dev Set the vault status. If status is false, withdraw all from lenders.
   * - Caller is Admin
   * @param _active The vault status.
   */
  function setActive(bool _active) external payable onlyAdmin {
    require(active != _active, Errors.AG_INVALID_CONFIGURATION);

    active = _active;
    if (!_active) {
      uint256 lendersCount = lenders.length;
      for (uint256 i; i < lendersCount; ++i) {
        IGenericLender lender = IGenericLender(lenders[i]);
        if (lender.hasAssets()) {
          lender.withdrawAll();
        }
      }
    }
  }

  /**
   * @dev Register the new lender with supply limit value.
   * - Caller is Admin
   * @param _lender The new lender address.
   * @param _supplyCap The deposit limit valut of lender.
   */
  function addLender(address _lender, uint256 _supplyCap) external payable onlyAdmin {
    require(_lender != address(0), Errors.AG_INVALID_CONFIGURATION);
    require(IGenericLender(_lender).ASSET() == address(_asset), Errors.AG_INVALID_CONFIGURATION);

    uint256 lenderCount = lenders.length;
    for (uint256 i; i < lenderCount; ++i) {
      require(_lender != lenders[i], Errors.AG_INVALID_CONFIGURATION);
    }

    lenders.push(_lender);
    if (_supplyCap != 0) {
      supplyCaps[_lender] = _supplyCap;
    }
  }

  /**
   * @dev Unregister the lender.
   * - Caller is Admin
   * @param _lender The unregistering lender address.
   */
  function removeLender(address _lender) external payable onlyAdmin {
    require(_lender != address(0), Errors.AG_INVALID_CONFIGURATION);

    uint256 lenderCount = lenders.length;
    for (uint256 i; i < lenderCount; ++i) {
      IGenericLender lender = IGenericLender(lenders[i]);
      if (_lender == address(lender)) {
        // Withdraw from lender
        if (lender.hasAssets()) {
          lender.withdrawAll();
        }

        if (i != lenderCount - 1) {
          lenders[i] = lenders[lenderCount - 1];
        }

        lenders.pop();
        delete supplyCaps[_lender];

        //if balance to spend we might as well put it into the best lender
        if (IERC20(_asset).balanceOf(address(this)) != 0) {
          _adjustPosition();
        }

        return;
      }
    }

    require(false, Errors.AG_INVALID_CONFIGURATION);
  }

  /**
   * @dev Set the supply limit value of registered lender.
   * - Caller is Admin
   * @param _lender The lender address.
   * @param _supplyCap The deposit limit valut of lender.
   */
  function setSupplyCap(address _lender, uint256 _supplyCap) external payable onlyAdmin {
    require(_lender != address(0), Errors.AG_INVALID_CONFIGURATION);
    require(IGenericLender(_lender).ASSET() == address(_asset), Errors.AG_INVALID_CONFIGURATION);

    supplyCaps[_lender] = _supplyCap;
  }

  /**
   * @dev Replace the existing lender with new lender. 
   *      This will withdraw all from old lender and deposit new lender keeping same supply limit value.
   * - Caller is Admin
   * @param _oldLender The existing lender address.
   * @param _newLender The new lender address.
   */
  function migrationLender(address _oldLender, address _newLender) external payable onlyAdmin {
    require(_oldLender != address(0), Errors.AG_INVALID_CONFIGURATION);
    require(_newLender != address(0), Errors.AG_INVALID_CONFIGURATION);

    uint256 lenderCount = lenders.length;
    for (uint256 i; i < lenderCount; ++i) {
      IGenericLender lender = IGenericLender(lenders[i]);
      uint256 migrationAmount;
      if (_oldLender == address(lender)) {
        // Withdraw from lender
        if (lender.hasAssets()) {
          migrationAmount = lender.withdrawAll();
        }

        // replace lender address
        if (i != lenderCount - 1) {
          lenders[i] = lenders[lenderCount - 1];
        }
        lenders[lenderCount - 1] = _newLender;

        // set supply caps
        uint256 oldSupplyCaps = supplyCaps[_oldLender];
        if (oldSupplyCaps != 0) {
          supplyCaps[_newLender] = oldSupplyCaps;
          delete supplyCaps[_oldLender];
        }

        //if there is migration amount, deposit to new lender
        if (migrationAmount != 0) {
          IERC20(_asset).safeTransfer(_newLender, migrationAmount);
          IGenericLender(_newLender).deposit();
        }

        return;
      }
    }

    require(false, Errors.AG_INVALID_CONFIGURATION);
  }

  /**
   * @dev Manually withdraw all from lender.
   * - Caller is Admin
   * @param _lender The lender address.
   */
  function manualWithdraw(address _lender) external payable onlyAdmin {
    require(_lender != address(0), Errors.AG_INVALID_CONFIGURATION);
    require(IGenericLender(_lender).hasAssets(), Errors.AG_INVALID_CONFIGURATION);

    IGenericLender(_lender).withdrawAll();
  }

  /**
   * @dev Adjust the position based on the lender's APR value.
   *      This will deposit most of assets to highest APR lender.
   */
  function adjustPosition() external nonReentrant {
    _adjustPosition();
  }

  /**
   * @dev Get the vault status.
   * @return the status of vault.
   */
  function isActive() external view returns (bool) {
    return active;
  }

  /**
   * @dev Get the admin address.
   * @return the address of admin.
   */
  function ADMIN() external view returns (address) {
    return admin;
  }

  /**
   * @dev Get the lender address.
   * @param id The index of lenders array.
   * @return the address of lender.
   */
  function getLender(uint256 id) external view returns (address) {
    return lenders[id];
  }

  /**
   * @dev Get the registered lender count.
   * @return the count of registered lender.
   */
  function getLenderCount() external view returns (uint256) {
    return lenders.length;
  }

  /**
   * @dev Get the supply limit value of lender.
   * @return the limit value of lender.
   */
  function getSupplyCap(address _lender) external view returns (uint256) {
    return supplyCaps[_lender];
  }

  /**
   * @dev Estimates highest and lowest apr lenders. 
   *      Public for debugging purposes but not much use to general public.
   * @return _lowest the lowest lender index.
   * @return _lowestApr the lowest APR value.
   * @return _highest the highest lender index.
   * @return _potential the potential APR after deposit to highest lender.
   * @return _adjustPositionAmount the amount of adjusting position.
   */

  function estimateAdjustPosition()
    public
    view
    virtual
    returns (
      uint256 _lowest,
      uint256 _lowestApr,
      uint256 _highest,
      uint256 _potential,
      uint256 _adjustPositionAmount
    )
  {
    //all loose assets are to be invested
    uint256 looseAssets = IERC20(_asset).balanceOf(address(this));

    // our simple algo
    // get the lowest apr strat
    // cycle through and see who could take its funds plus asset for the highest apr
    _lowestApr = type(uint256).max;
    uint256 lowestAssetAmount;
    uint256 lendersCount = lenders.length;
    uint256 highestApr;
    uint256 highestAssetAmount;

    for (uint256 i; i < lendersCount; ++i) {
      IGenericLender lender = IGenericLender(lenders[i]);
      uint256 lenderTotalAssets = lender.totalAssets();
      if (lenderTotalAssets != 0) {
        uint256 apr = IGenericLender(lender).apr();
        if (apr < _lowestApr) {
          _lowestApr = apr;
          _lowest = i;
          lowestAssetAmount = lenderTotalAssets;
        }
      }

      uint256 aprAfterDeposit = lender.aprAfterDeposit(looseAssets);
      uint256 supplyCap = supplyCaps[address(lender)];
      if (aprAfterDeposit > highestApr && (supplyCap == 0 || lenderTotalAssets < supplyCap - 1)) {
        highestApr = aprAfterDeposit;
        _highest = i;
        highestAssetAmount = lenderTotalAssets;
      }
    }

    //if we can improve apr by withdrawing we do so
    uint256 highestSupplyCap = supplyCaps[lenders[_highest]];
    if (highestSupplyCap != 0) {
      if (looseAssets + highestAssetAmount >= highestSupplyCap - 1) {
        looseAssets = highestSupplyCap - highestAssetAmount;
      } else if (lowestAssetAmount + looseAssets + highestAssetAmount > highestSupplyCap - 1) {
        _adjustPositionAmount = highestSupplyCap - highestAssetAmount - looseAssets;
      } else {
        _adjustPositionAmount = lowestAssetAmount;
      }
    } else {
      _adjustPositionAmount = lowestAssetAmount;
    }

    _potential = IGenericLender(lenders[_highest]).aprAfterDeposit(
      _adjustPositionAmount + looseAssets
    );
  }

  /*
   * Key logic.
   *   The algorithm moves assets from lowest return to highest
   *   like a very slow idiots bubble sort
   */
  function _adjustPosition() internal virtual {
    if (!active) {
      return;
    }

    //we just keep all money if we dont have any lenders
    if (lenders.length == 0) {
      return;
    }

    (
      uint256 lowest,
      uint256 lowestApr,
      uint256 highest,
      uint256 potential,
      uint256 adjustPositionAmount
    ) = estimateAdjustPosition();

    if (potential > lowestApr && adjustPositionAmount != 0) {
      //apr should go down after deposit so wont be withdrawing from self
      IGenericLender(lenders[lowest]).withdraw(adjustPositionAmount);
    }

    IERC20 asset = IERC20(_asset);
    uint256 bal = asset.balanceOf(address(this));
    if (bal != 0) {
      address highestLender = lenders[highest];
      uint256 highestSupplyCap = supplyCaps[highestLender];
      uint256 highestTotalAssets = IGenericLender(highestLender).totalAssets();

      if (highestSupplyCap != 0 && bal + highestTotalAssets > highestSupplyCap - 1) {
        bal = highestSupplyCap - highestTotalAssets;
      }

      asset.safeTransfer(highestLender, bal);
      IGenericLender(highestLender).deposit();
    }
  }

  //share must add up to 1000. 500 means 50% etc
  function manualAllocation(lenderRatio[] memory _newPositions) external payable onlyAdmin {
    uint256 share = 0;
    uint256 lenderLength = lenders.length;

    for (uint256 i; i < lenderLength; ++i) {
      IGenericLender(lenders[i]).withdrawAll();
    }

    IERC20 asset = IERC20(_asset);
    uint256 assets = asset.balanceOf(address(this));
    uint256 positionLength = _newPositions.length;
    for (uint256 i; i < positionLength; ++i) {
      bool found = false;

      //might be annoying and expensive to do this second loop but worth it for safety
      for (uint256 j; j < lenderLength; ++j) {
        if (lenders[j] == _newPositions[i].lender) {
          found = true;
          break;
        }
      }
      require(found, Errors.AG_INVALID_CONFIGURATION);

      share +=_newPositions[i].share;
      uint256 toSend = assets * _newPositions[i].share / 1000;
      uint256 supplyCap = supplyCaps[_newPositions[i].lender];
      uint256 totalAssets = IGenericLender(_newPositions[i].lender).totalAssets();

      require(supplyCap == 0 || toSend + totalAssets <= supplyCap - 1, Errors.AG_INVALID_CONFIGURATION);

      asset.safeTransfer(_newPositions[i].lender, toSend);
      IGenericLender(_newPositions[i].lender).deposit();
    }

    require(share == 1000, Errors.AG_INVALID_CONFIGURATION);
  }

  /*
   * Liquidate as many assets as possible to `asset`, irregardless of slippage,
   * up to `_amountNeeded`. Any excess should be re-invested here as well.
   */
  function _liquidatePosition(uint256 _amountNeeded) internal returns (uint256) {
    uint256 _balance = IERC20(_asset).balanceOf(address(this));
    if (_balance >= _amountNeeded) {
      return _amountNeeded;
    }

    uint256 received = _balance;
    received += _withdrawSome(_amountNeeded - _balance);
    if (received >= _amountNeeded) {
      return _amountNeeded;
    }

    return received;
  }

  //cycle through withdrawing from worst rate first
  function _withdrawSome(uint256 _amount) internal returns (uint256 amountWithdrawn) {
    uint256 lendersCount = lenders.length;
    if (lendersCount == 0) {
      return 0;
    }

    //most situations this will only run once. Only big withdrawals will be a gas guzzler
    uint256 j;
    while (amountWithdrawn < _amount) {
      uint256 lowestApr = type(uint256).max;
      uint256 lowest;
      for (uint256 i; i < lendersCount; ++i) {
        IGenericLender lender = IGenericLender(lenders[i]);
        if (lender.hasAssets()) {
          uint256 apr = lender.apr();
          if (apr < lowestApr) {
            lowestApr = apr;
            lowest = i;
          }
        }
      }

      IGenericLender lowestLender = IGenericLender(lenders[lowest]);
      if (!lowestLender.hasAssets()) {
        return amountWithdrawn;
      }

      amountWithdrawn += lowestLender.withdraw(_amount - amountWithdrawn);
      j++;

      //dont want infinite loop
      if (j >= 6) {
        return amountWithdrawn;
      }
    }
  }

  /// -----------------------------------------------------------------------
  /// ERC4626 overrides
  /// -----------------------------------------------------------------------
  function totalAssets() public view override returns (uint256) {
    uint256 lenderCount = lenders.length;
    uint256 totalAmount = IERC20(_asset).balanceOf(address(this));

    for (uint256 i; i < lenderCount; ++i) {
      totalAmount += IGenericLender(lenders[i]).totalAssets();
    }

    return totalAmount;
  }

  function maxDeposit(address) public view override returns (uint256) {
    if (!_checkDepositPool()) return 0;

    return type(uint256).max;
  }

  function maxMint(address) public view override returns (uint256) {
    if (!_checkDepositPool()) return 0;

    return type(uint256).max;
  }

  function maxWithdraw(address owner) public view override returns (uint256) {
    return convertToAssets(balanceOf(owner));
  }

  function maxRedeem(address owner) public view override returns (uint256) {
    return balanceOf(owner);
  }

  function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
    super.deposit(assets, receiver);
  }

  function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
    super.mint(shares, receiver);
  }

  function withdraw(
    uint256 assets,
    address receiver,
    address owner
  ) public override nonReentrant returns (uint256) {
    super.withdraw(assets, receiver, owner);
  }

  function redeem(
    uint256 shares,
    address receiver,
    address owner
  ) public override nonReentrant returns (uint256) {
    super.redeem(shares, receiver, owner);
  }

  function _withdraw(
    address caller,
    address receiver,
    address owner,
    uint256 assets,
    uint256 shares
  ) internal override {
    if (caller != owner) {
      _spendAllowance(owner, caller, shares);
    }

    uint256 withdrawAssets = _liquidatePosition(assets);
    uint256 withdrawShares = shares;

    if (withdrawAssets != assets) {
      withdrawShares = convertToShares(withdrawAssets);
    }

    _burn(owner, withdrawShares);
    IERC20(_asset).safeTransfer(receiver, withdrawAssets);

    emit Withdraw(caller, receiver, owner, withdrawAssets, withdrawShares);
  }

  /**
   * @dev check the pool status before deposit/mint
   */
  function _checkDepositPool() internal view returns (bool) {
    return active;
  }
}
