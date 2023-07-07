import {
  LendingPoolAddressesProvider__factory,
  Aggregator__factory,
  MintableERC20__factory,
  IERC20Detailed__factory,
} from '../types';
import { getEthersSigners } from './contracts-helpers';
import { DRE, getDb } from './misc-utils';
import { eContractid, tEthereumAddress } from './types';

export const getFirstSigner = async () => (await getEthersSigners())[0];

export const getLendingPoolAddressesProvider = async (address?: tEthereumAddress) => {
  return await LendingPoolAddressesProvider__factory.connect(
    address ||
      (
        await getDb().get(`${eContractid.LendingPoolAddressesProvider}.${DRE.network.name}`).value()
      ).address,
    await getFirstSigner()
  );
};

export const getAggregator = async (assetSymbol: string, address?: tEthereumAddress) =>
  await Aggregator__factory.connect(
    address ||
      (
        await getDb()
          .get(`${assetSymbol.toUpperCase() + eContractid.Aggregator}.${DRE.network.name}`)
          .value()
      ).address,
    await getFirstSigner()
  );

export const getIErc20Detailed = async (address: tEthereumAddress) =>
  await IERC20Detailed__factory.connect(
    address ||
      (
        await getDb().get(`${eContractid.IERC20Detailed}.${DRE.network.name}`).value()
      ).address,
    await getFirstSigner()
  );

export const getMintableERC20 = async (address: tEthereumAddress) =>
  await MintableERC20__factory.connect(
    address ||
      (
        await getDb().get(`${eContractid.MintableERC20}.${DRE.network.name}`).value()
      ).address,
    await getFirstSigner()
  );