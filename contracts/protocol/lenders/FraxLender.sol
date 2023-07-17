// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import './GenericLender.sol';
import {SafeERC20} from '../../libraries/SafeERC20.sol';
import {IERC20} from '../../interfaces/IERC20.sol';
import {Errors} from '../../libraries/Errors.sol';

interface IFraxlendPair {
  function currentRateInfo()
    external
    view
    returns (uint64 lastBlock, uint64 feeToProtocolRate, uint64 lastTimestamp, uint64 ratePerSec);

  function totalAsset() external view returns (uint128 amount, uint128 shares);

  function totalBorrow() external view returns (uint128 amount, uint128 shares);

  function paused() external view returns (bool);

  function maturityDate() external view returns (uint256);

  function penaltyRate() external view returns (uint256);

  function rateContract() external view returns (address);

  function rateInitCallData() external view returns (bytes calldata);

  function toAssetShares(uint256 _amount, bool _roundUp) external view returns (uint256);

  function toAssetAmount(uint256 _shares, bool _roundUp) external view returns (uint256);

  function getConstants()
    external
    pure
    returns (
      uint256 _LTV_PRECISION,
      uint256 _LIQ_PRECISION,
      uint256 _UTIL_PREC,
      uint256 _FEE_PRECISION,
      uint256 _EXCHANGE_PRECISION,
      uint64 _DEFAULT_INT,
      uint16 _DEFAULT_PROTOCOL_FEE,
      uint256 _MAX_PROTOCOL_FEE
    );

  function deposit(uint256 _amount, address _receiver) external returns (uint256 _sharesReceived);

  function redeem(
    uint256 _shares,
    address _receiver,
    address _owner
  ) external returns (uint256 _amountToReturn);
}

interface IRateCalculator {
  function getNewRate(
    bytes calldata _data,
    bytes calldata _initData
  ) external pure returns (uint64 _newRatePerSec);
}

contract FraxLender is GenericLender {
  using SafeERC20 for IERC20;

  address private pair;

  constructor(
    address _aggregator,
    string memory _name,
    address _pair
  ) GenericLender(_aggregator, _name) {
    _initialize(_pair);
  }

  function initialize(address _pair) external {
    _initialize(_pair);
  }

  function cloneFraxLender(
    address _aggregator,
    string memory _name,
    address _pair
  ) external returns (address newLender) {
    newLender = _clone(_aggregator, _name);
    FraxLender(newLender).initialize(_pair);
  }

  function PAIR() external view returns (address) {
    return pair;
  }

  function totalAssets() external view returns (uint256) {
    address pool = pair;
    uint256 shares = IERC20(pool).balanceOf(address(this));

    return IFraxlendPair(pool).toAssetAmount(shares, false);
  }

  function name() external view returns (string memory) {
    return lenderName;
  }

  function ASSET() external view returns (address) {
    return address(asset);
  }

  function AGGREGATOR() external view returns (address) {
    return aggregator;
  }

  function apr() external view returns (uint256) {
    (, , , uint256 ratePerSec) = IFraxlendPair(pair).currentRateInfo();

    return ratePerSec * YEAR_SEC;
  }

  function hasAssets() external view returns (bool) {
    return IERC4626(pair).balanceOf(address(this)) > 0;
  }

  function aprAfterDeposit(uint256 amount) external view returns (uint256) {
    IFraxlendPair pool = IFraxlendPair(pair);
    (uint64 lastBlock, , uint64 lastTimestamp, uint256 ratePerSec) = pool.currentRateInfo();

    if (lastTimestamp == block.timestamp) {
      return ratePerSec * YEAR_SEC;
    }

    (uint256 assetAmount, ) = pool.totalAsset();
    (uint256 borrowAmount, uint256 borrowShares) = pool.totalBorrow();
    (, , uint256 UTIL_PREC, , , uint256 DEFAULT_INT, , ) = pool.getConstants();
    if (borrowShares == 0 && !pool.paused()) {
      ratePerSec = DEFAULT_INT;
    } else {
      uint256 deltaTime = block.timestamp - lastTimestamp;
      uint256 utilizationRate = (UTIL_PREC * borrowAmount) / (assetAmount + amount);
      uint256 maturityDate = pool.maturityDate();
      if (maturityDate != 0 && block.timestamp > maturityDate) {
        ratePerSec = pool.penaltyRate();
      } else {
        bytes memory rateData = abi.encode(
          ratePerSec,
          deltaTime,
          utilizationRate,
          block.number - lastBlock
        );
        IRateCalculator rateContract = IRateCalculator(pool.rateContract());
        bytes memory rateInitCallData = pool.rateInitCallData();
        ratePerSec = rateContract.getNewRate(rateData, rateInitCallData);
      }
    }

    return ratePerSec * YEAR_SEC;
  }

  function withdraw(uint256 amount) external onlyAggregator returns (uint256) {
    IFraxlendPair pool = IFraxlendPair(pair);
    uint256 shares = pool.toAssetShares(amount, true);

    return pool.redeem(shares, aggregator, address(this));
  }

  function deposit() external onlyAggregator {
    uint256 assetAmount = asset.balanceOf(address(this));
    require(assetAmount != 0, Errors.AG_INVALID_CONFIGURATION);

    address pool = pair;
    asset.safeApprove(pool, assetAmount);
    IFraxlendPair(pool).deposit(assetAmount, address(this));
  }

  function withdrawAll() external onlyAggregator returns (uint256) {
    address pool = pair;
    uint256 shares = IERC20(pool).balanceOf(address(this));
    (, uint256 assetShares) = IFraxlendPair(pool).totalAsset();
    (, uint256 borrowShares) = IFraxlendPair(pool).totalBorrow();

    if (assetShares - borrowShares < shares) {
      // insufficient liquidity case
      shares = assetShares - borrowShares;
    }

    return IFraxlendPair(pool).redeem(shares, aggregator, address(this));
  }

  function _initialize(address _pair) internal {
    require(address(pair) == address(0), Errors.AG_ALREADY_INITIALIZED);

    pair = _pair;
  }
}
