// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

interface IGenericLender {
  function name() external view returns (string memory);

  function ASSET() external view returns (address);

  function totalAssets() external view returns (uint256);

  function AGGREGATOR() external view returns (address);

  function apr() external view returns (uint256);

  function hasAssets() external view returns (bool);

  function aprAfterDeposit(uint256 amount) external view returns (uint256);

  function withdraw(uint256 amount) external returns (uint256);

  function deposit() external;

  function withdrawAll() external returns (uint256);
}
