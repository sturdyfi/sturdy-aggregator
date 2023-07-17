import { ISturdyConfiguration, eEthereumNetwork } from '../helpers/types';

// ----------------
// POOL--SPECIFIC PARAMS
// ----------------

export const SturdyConfig: ISturdyConfiguration = {
  FRAX: {
    [eEthereumNetwork.main]: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
    [eEthereumNetwork.tenderly]: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
  },
};

export default SturdyConfig;
