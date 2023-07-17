import { task } from 'hardhat/config';
import { deployLendingPoolAddressesProvider } from '../helpers/contracts-deployments';
import {
  ConfigNames,
} from '../helpers/configuration';
import { getEthersSigners } from '../helpers/contracts-helpers';
import { waitForTx } from '../helpers/misc-utils';

task(
  'full:deploy-address-provider',
  'Deploy address provider, registry and fee provider for dev enviroment'
)
  .addFlag('verify', 'Verify contracts at Etherscan')
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .addFlag('skipRegistry')
  .setAction(async ({ verify }, DRE) => {
    await DRE.run('set-DRE');
    const signers = await getEthersSigners();

    // 1. Deploy address provider and set genesis manager
    const addressesProvider = await deployLendingPoolAddressesProvider('1', verify);

    // 2. Set pool admins
    await waitForTx(await addressesProvider.setPoolAdmin(await signers[0].getAddress()));
  });
