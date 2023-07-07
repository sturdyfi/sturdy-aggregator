import { DRE, waitForTx } from './misc-utils';
import {
  eContractid,
} from './types';
import {
  getFirstSigner,
  getLendingPoolAddressesProvider,
  getAggregator,
} from './contracts-getters';
import {
  LendingPoolAddressesProvider__factory,
  Aggregator__factory,
  FraxLender,
  FraxLender__factory,
} from '../types';
import {
  withSaveAndVerify,
  rawInsertContractAddressInDb,
} from './contracts-helpers';

export const deployLendingPoolAddressesProvider = async (marketId: string, verify?: boolean) =>
  withSaveAndVerify(
    await new LendingPoolAddressesProvider__factory(await getFirstSigner()).deploy(marketId),
    eContractid.LendingPoolAddressesProvider,
    [marketId],
    verify
  );


export const deployFraxLender = async (args: [string, string, string], verify?: boolean) =>
  withSaveAndVerify(
    await new FraxLender__factory(await getFirstSigner()).deploy(...args),
    args[1].toUpperCase() + eContractid.FraxLender,
    args,
    verify
  );

export const cloneFraxLender = async (args: [string, string, string], fromLender: FraxLender) => {
  const tx = await fromLender.cloneFraxLender(...args);
  const rc = await tx.wait();
  const event = rc.events?.find((event) => event.event === 'Cloned');
  const newLenderAddress = event?.args?.[0];
  await rawInsertContractAddressInDb(
    args[1].toUpperCase() + eContractid.FraxLender,
    newLenderAddress
  );

  return FraxLender__factory.connect(newLenderAddress, await getFirstSigner());
};

export const deployAggregator = async (assetSymbol: string, asset: string, verify?: boolean) => {
  const impl = await withSaveAndVerify(
    await new Aggregator__factory(await getFirstSigner()).deploy(asset),
    assetSymbol.toUpperCase() + eContractid.AggregatorImpl,
    [asset],
    verify
  );

  const addressesProvider = await getLendingPoolAddressesProvider();
  await waitForTx(await impl.initialize(addressesProvider.address));
  await waitForTx(
    await addressesProvider.setAddressAsProxy(
      DRE.ethers.utils.formatBytes32String(assetSymbol.toUpperCase() + '_AGGREGATOR'),
      impl.address
    )
  );

  const proxyAddress = await addressesProvider.getAddress(
    DRE.ethers.utils.formatBytes32String(assetSymbol.toUpperCase() + '_AGGREGATOR')
  );
  await rawInsertContractAddressInDb(
    assetSymbol.toUpperCase() + eContractid.Aggregator,
    proxyAddress
  );

  return await getAggregator(assetSymbol);
};
