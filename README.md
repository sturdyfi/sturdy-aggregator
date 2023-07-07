# Dev Environment
- Configure environment file (.env)
```
ALCHEMY_KEY="xxx"
```

- Install
```
yarn install
```

- Compile
```
yarn compile
```

- Run the hardhat node on localhost.
```
FORK=main yarn hardhat node
```

- For test, run the following task 
```
yarn test
```

# Aggregator

## User Action

### Deposit

Deposit `assets` (FRAX) into the vault.

- @param `assets` The amount of assets to deposit.
- @param `receiver` The address to receive the shares.
  ```
  function deposit(uint256 assets, address receiver) external;
  ```

### Mint

Mint `shares` (FRAX) for the receiver.

- @param `shares` The amount of shares to mint.
- @param `receiver` The address to receive the shares.
  ```
  function mint(uint256 shares, address receiver) external;
  ```

### Withdraw

Withdraw an amount of asset (FRAX) to `receiver` burning `owner`s shares.

- @param `assets` The amount of asset to withdraw.
- @param `receiver` The address to receive the assets.
- @param `owner` The address who's shares are being burnt.
  ```
  function withdraw(
    uint256 assets,
    address receiver,
    address owner
  ) external;
  ```

### Redeem

Redeems an amount of shares (FRAX) of `owners` shares sending funds to `receiver`.

- @param `shares` The amount of shares to burn.
- @param `receiver` The address to receive the assets.
- @param `owner` The address who's shares are being burnt.
  ```
  function redeem(
    uint256 shares,
    address receiver,
    address owner
  ) external;
  ```

### AdjustPosition

Adjust the position based on the lender's APR value.
This will deposit most of assets to highest APR lender.

  ```
  function adjustPosition() external
  ```

### EstimateAdjustPosition

Estimates highest and lowest apr lenders. 
Public for debugging purposes but not much use to general public.

- @return the lowest lender index.
- @return the lowest APR value.
- @return the highest lender index.
- @return the potential APR after deposit to highest lender.
- @return the amount of adjusting position.

  ```
  function estimateAdjustPosition()
    public
    view
    returns (
      uint256 _lowest,
      uint256 _lowestApr,
      uint256 _highest,
      uint256 _potential,
      uint256 _adjustPositionAmount
    )
  ```

## Admin Action

### Init

Init the lp token name, symbol, decimals.

- @param `_name` The lp token name.
- @param `_symbol` The lp token symbol.
- @param `decimals` The lp token decimals.
  ```
  function init(
    string memory _name,
    string memory _symbol,
    uint8 decimals
  ) external;
  ```

### SetAdmin

Set the admin address.

- @param `_admin` The address of admin.
  ```
  function setAdmin(address _admin) external;
  ```

### SetActive

Set the vault status. If status is false, withdraw all from lenders.

- @param `_active` The vault status.
  ```
  function setActive(bool _active) external;
  ```

### AddLender

Register the new lender with supply limit value.

- @param `_lender` The new lender address.
- @param `_supplyCap` The deposit limit valut of lender.
  ```
  function addLender(address _lender, uint256 _supplyCap) external;
  ```

### RemoveLender

Unregister the lender.

- @param `_lender` The unregistering lender address.
  ```
  function removeLender(address _lender) external;
  ```

### SetSupplyCap

Set the supply limit value of registered lender.

- @param `_lender` The lender address.
- @param `_supplyCap` The deposit limit valut of lender.
  ```
  function setSupplyCap(address _lender, uint256 _supplyCap) external;
  ```

### MigrationLender

Replace the existing lender with new lender. 
This will withdraw all from old lender and deposit new lender keeping same supply limit value.

- @param `_oldLender` The existing lender address.
- @param `_newLender` The new lender address.
  ```
  function migrationLender(address _oldLender, address _newLender) external;
  ```

### ManualWithdraw

Manually withdraw all from lender.

- @param `_lender` The lender address.
  ```
  function manualWithdraw(address _lender) external;
  ```