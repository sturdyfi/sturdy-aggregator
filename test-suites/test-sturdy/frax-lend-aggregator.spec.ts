import { SignerWithAddress, TestEnv, makeSuite } from './helpers/make-suite';
import {
  cloneFraxLender,
  deployAggregator,
  deployFraxLender,
} from '../../helpers/contracts-deployments';
import { Aggregator, FraxLender } from '../../types';
import { ZERO_ADDRESS } from '../../helpers/constants';
import { convertToCurrencyDecimals } from '../../helpers/contracts-helpers';
import { mint } from './helpers/mint';
import { advanceBlock, timeLatest } from '../../helpers/misc-utils';
import { parseEther } from 'ethers/lib/utils';

const { expect } = require('chai');
const FRAX_CRV_PAIR_ADDRESS = '0x3835a58CA93Cdb5f912519ad366826aC9a752510';
const FRAX_CVX_PAIR_ADDRESS = '0xa1D100a5bf6BFd2736837c97248853D989a9ED84';
const YIELD_PERIOD = 100000;

const setupAggregator = async (asset: string, admin: SignerWithAddress) => {
  // deploy FRAX aggregator contract
  const aggregator = await deployAggregator('FRAX', asset);
  await aggregator.setAdmin(admin.address);
  await aggregator.connect(admin.signer).setActive(true);
  await aggregator.connect(admin.signer).init('Frax Aggregator', 'frax-ag-lp', 18);

  // deploy CRV FraxLender
  const crvLender = await deployFraxLender([
    aggregator.address,
    'FRAX_CRV_Lender',
    FRAX_CRV_PAIR_ADDRESS,
  ]);
  // deploy CVX FraxLender
  const cvxLender = await cloneFraxLender(
    [aggregator.address, 'FRAX_CVX_Lender', FRAX_CVX_PAIR_ADDRESS],
    crvLender
  );

  // add CRV, CVX FraxLender to aggregator
  await aggregator.connect(admin.signer).addLender(crvLender.address, parseEther('8000'));
  await aggregator.connect(admin.signer).addLender(cvxLender.address, 0);

  return { aggregator, crvLender, cvxLender };
};

makeSuite('FraxLendAggregator - Clone lender', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    // deploy FRAX aggregator contract
    aggregator = await deployAggregator('FRAX', FRAX.address);
  });

  it('Check Aggregator configuration', async () => {
    const { FRAX } = testEnv;

    expect(await aggregator.name()).to.be.eq('');
    expect(await aggregator.symbol()).to.be.eq('');
    expect(await aggregator.decimals()).to.be.eq(0);
    expect(await aggregator.ADMIN()).to.be.eq(ZERO_ADDRESS);
    expect(await aggregator.asset()).to.be.eq(FRAX.address);
    expect(await aggregator.getLenderCount()).to.be.eq(0);
    expect(await aggregator.isActive()).to.be.eq(false);
  });

  it('Init Aggregator', async () => {
    const { FRAX } = testEnv;

    await aggregator.setAdmin(admin.address);
    await aggregator.connect(admin.signer).setActive(true);
    await aggregator.connect(admin.signer).init('Frax Aggregator', 'frax-ag-lp', 18);

    expect(await aggregator.name()).to.be.eq('Frax Aggregator');
    expect(await aggregator.symbol()).to.be.eq('frax-ag-lp');
    expect(await aggregator.decimals()).to.be.eq(18);
    expect(await aggregator.ADMIN()).to.be.eq(admin.address);
    expect(await aggregator.asset()).to.be.eq(FRAX.address);
    expect(await aggregator.getLenderCount()).to.be.eq(0);
    expect(await aggregator.isActive()).to.be.eq(true);
  });

  it('Deploy CRV FraxLender', async () => {
    const { FRAX } = testEnv;

    crvLender = await deployFraxLender([
      aggregator.address,
      'FRAX_CRV_Lender',
      FRAX_CRV_PAIR_ADDRESS,
    ]);

    expect(await crvLender.ASSET()).to.be.eq(FRAX.address);
    expect(await crvLender.PAIR()).to.be.eq(FRAX_CRV_PAIR_ADDRESS);
    expect(await crvLender.AGGREGATOR()).to.be.eq(aggregator.address);
    expect(await crvLender.name()).to.be.eq('FRAX_CRV_Lender');
    expect(await crvLender.totalAssets()).to.be.eq(0);
    expect(await crvLender.apr()).to.not.be.eq(0);
    expect(await crvLender.hasAssets()).to.be.eq(false);
  });

  it('Clone CRV FraxLender for CVX FraxLender', async () => {
    const { FRAX } = testEnv;

    const cvxLender = await cloneFraxLender(
      [aggregator.address, 'FRAX_CVX_Lender', FRAX_CVX_PAIR_ADDRESS],
      crvLender
    );

    expect(await cvxLender.ASSET()).to.be.eq(FRAX.address);
    expect(await cvxLender.PAIR()).to.be.eq(FRAX_CVX_PAIR_ADDRESS);
    expect(await cvxLender.AGGREGATOR()).to.be.eq(aggregator.address);
    expect(await cvxLender.name()).to.be.eq('FRAX_CVX_Lender');
    expect(await cvxLender.totalAssets()).to.be.eq(0);
    expect(await cvxLender.apr()).to.not.be.eq(0);
    expect(await cvxLender.hasAssets()).to.be.eq(false);
  });
});

makeSuite('FraxLendAggregator - deposit/withdraw', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('Check Aggregator added lenders', async () => {
    expect(await aggregator.getLenderCount()).to.be.eq(2);
    expect(await aggregator.getLender(0)).to.be.eq(crvLender.address);
    expect(await aggregator.getLender(1)).to.be.eq(cvxLender.address);
    expect(await aggregator.getSupplyCap(crvLender.address)).to.be.eq(parseEther('8000'));
    expect(await aggregator.getSupplyCap(cvxLender.address)).to.be.eq(0);
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User1 Withdraw 3000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const withdrawAmount = await convertToCurrencyDecimals(FRAX.address, '3000');

    //Withdraw
    await aggregator.connect(user1.signer).withdraw(withdrawAmount, user1.address, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(withdrawAmount);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(withdrawAmount.mul(4));
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(withdrawAmount.div(3).mul(2));
  });

  it('User2 Withdraw 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const withdrawAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Withdraw
    await aggregator.connect(user2.signer).withdraw(withdrawAmount, user2.address, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(withdrawAmount);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(withdrawAmount.div(5));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(0);
  });

  it('User1 Withdraw 2000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const withdrawAmount = await convertToCurrencyDecimals(FRAX.address, '2000');

    //Withdraw
    await aggregator.connect(user1.signer).withdraw(withdrawAmount, user1.address, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(withdrawAmount.mul(5).div(2));
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(0);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(0);
  });
});

makeSuite('FraxLendAggregator - deposit/adjustPosition', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User3 run adjustPosition', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(1));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(1));
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(
      lendAmount.div(15).mul(8)
    );
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(0);
  });

  it('After for a while, User4 deposit 2000 FRAX and run adjustPosition, then user1,user2 amount would be increased', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const user4 = users[4];
    const user1Amount = await convertToCurrencyDecimals(FRAX.address, '5000');
    const user2Amount = await convertToCurrencyDecimals(FRAX.address, '10000');
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '2000');

    await advanceBlock((await timeLatest()).plus(YIELD_PERIOD).toNumber());

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user4);

    //Approve aggregator
    await FRAX.connect(user4.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user4.signer).deposit(depositAmount, user4.address);

    expect(await FRAX.balanceOf(user4.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.div(2).mul(9));
    expect(await aggregator.balanceOf(user4.address)).to.be.eq(depositAmount);

    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    //adjustPosition to process remained asset
    await aggregator.connect(user4.signer).adjustPosition();

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(0);
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(0);
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(
      depositAmount.div(2).mul(9)
    );

    // there is no yield yet
    expect(await aggregator.totalAssets()).to.be.lte(
      user1Amount.add(user2Amount).add(depositAmount)
    );

    // call withdraw to make yield
    await aggregator.connect(admin.signer).manualWithdraw(crvLender.address);

    // there would be yield
    expect(await aggregator.totalAssets()).to.be.gt(
      user1Amount.add(user2Amount).add(depositAmount)
    );

    expect(await aggregator.convertToAssets(user1Amount)).to.be.gt(user1Amount);
    expect(await aggregator.convertToAssets(user2Amount)).to.be.gt(user2Amount);
    expect(await aggregator.convertToAssets(depositAmount)).to.be.gt(depositAmount);
  });
});

makeSuite('FraxLendAggregator - deposit/adjustPosition/removeLender', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User3 run adjustPosition', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(1));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(1));
    expect(afterFRAXAmountOfPair.sub(beforeFRAXAmountOfPair)).to.be.eq(lendAmount.div(15).mul(8));
  });

  it('remove CRV Lender, then position would be changed to CVX Lender', async () => {
    const { FRAX } = testEnv;
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // remove CRV Lender
    await aggregator.connect(admin.signer).removeLender(crvLender.address);

    const afterFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await aggregator.getLenderCount()).to.be.eq(1);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(0);
    expect(await aggregator.totalAssets()).to.be.gt(lendAmount);
    expect(await aggregator.convertToAssets(lendAmount)).to.be.gt(lendAmount);
    expect(afterFRAXAmountOfPair.sub(beforeFRAXAmountOfPair).sub(1)).to.be.eq(
      await aggregator.totalAssets()
    );
  });
});

makeSuite('FraxLendAggregator - deposit/adjustPosition/withdraw', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User3 run adjustPosition', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(1));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(1));
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(
      lendAmount.div(15).mul(8)
    );
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(0);
  });

  it('User3 run adjustPosition again to process remained asset', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const user4 = users[4];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(0);
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(2));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(2));
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(0);
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(
      lendAmount.div(15).mul(7)
    );
  });

  it('User2 withdraw 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const withdrawAmount = await convertToCurrencyDecimals(FRAX.address, '5000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // withdraw
    await aggregator.connect(user2.signer).withdraw(withdrawAmount, user2.address, user2.address);

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.gt(0);
    expect(await aggregator.totalAssets()).to.be.gt(withdrawAmount.mul(2));
    expect(await aggregator.convertToAssets(withdrawAmount.mul(2))).to.be.gt(withdrawAmount.mul(2));
    expect(beforeFRAXAmountOfHighPair.sub(afterFRAXAmountOfHighPair)).to.be.eq(0);
    expect(beforeFRAXAmountOfLowPair.sub(afterFRAXAmountOfLowPair)).to.be.eq(
      withdrawAmount.add(await FRAX.balanceOf(aggregator.address))
    );
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(withdrawAmount.sub(1));
  });
});

makeSuite('FraxLendAggregator - deposit/adjustPosition/DeActive', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User3 run adjustPosition', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(1));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(1));
    expect(afterFRAXAmountOfPair.sub(beforeFRAXAmountOfPair)).to.be.eq(lendAmount.div(15).mul(8));
  });

  it('Deactive aggregator', async () => {
    const { FRAX } = testEnv;
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);

    // deactive
    await aggregator.connect(admin.signer).setActive(false);

    const afterFRAXAmountOfPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    expect(await aggregator.isActive()).to.be.eq(false);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.gt(lendAmount);
    expect(await aggregator.totalAssets()).to.be.gt(lendAmount);
    expect(await aggregator.convertToAssets(lendAmount)).to.be.gt(lendAmount);
    expect(beforeFRAXAmountOfPair.sub(afterFRAXAmountOfPair)).to.be.eq(
      (await aggregator.totalAssets()).sub(lendAmount.div(15).mul(7))
    );
  });
});

makeSuite('FraxLendAggregator - deposit/adjustPosition/migration', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('User3 run adjustPosition', async () => {
    const { users, FRAX } = testEnv;
    const user3 = users[3];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(user3.signer).adjustPosition();

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(1));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(1));
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(
      lendAmount.div(15).mul(8)
    );
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(0);
  });

  it('Deploy new CRV Lender and migation from older to newer', async () => {
    const { FRAX } = testEnv;
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // deploy new CRV FraxLender
    const newCrvLender = await cloneFraxLender(
      [aggregator.address, 'FRAX_CRV_Lender', FRAX_CRV_PAIR_ADDRESS],
      crvLender
    );

    expect(await crvLender.totalAssets()).to.be.eq(lendAmount.div(15).mul(8).sub(1));
    expect(await newCrvLender.totalAssets()).to.be.eq(0);

    //migration
    await aggregator.connect(admin.signer).migrationLender(crvLender.address, newCrvLender.address);

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await aggregator.getSupplyCap(crvLender.address)).to.be.eq(0);
    expect(await aggregator.getSupplyCap(newCrvLender.address)).to.be.eq(parseEther('8000'));
    expect(await crvLender.totalAssets()).to.be.eq(0);
    expect(await newCrvLender.totalAssets()).to.be.gt(lendAmount.div(15).mul(8));
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(lendAmount.div(15).mul(7));
    expect(await aggregator.totalAssets()).to.be.gt(lendAmount);
    expect(await aggregator.convertToAssets(lendAmount)).to.be.gt(lendAmount);
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.eq(0);
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.eq(0);
  });
});

makeSuite('FraxLendAggregator - deposit/manualAllocation', (testEnv: TestEnv) => {
  let aggregator: Aggregator;
  let crvLender: FraxLender;
  let cvxLender: FraxLender;
  let admin: SignerWithAddress;

  before(async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];

    const ret = await setupAggregator(FRAX.address, admin);
    aggregator = ret.aggregator;
    crvLender = ret.crvLender;
    cvxLender = ret.cvxLender;
  });

  it('User1 Deposit 5000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user1 = users[1];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '5000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user1);

    //Approve aggregator
    await FRAX.connect(user1.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user1.signer).deposit(depositAmount, user1.address);

    expect(await FRAX.balanceOf(user1.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount);
    expect(await aggregator.balanceOf(user1.address)).to.be.eq(depositAmount);
  });

  it('User2 Deposit 10000 FRAX', async () => {
    const { users, FRAX } = testEnv;
    const user2 = users[2];
    const depositAmount = await convertToCurrencyDecimals(FRAX.address, '10000');

    //Prepare FRAX
    await mint('FRAX', depositAmount.toString(), user2);

    //Approve aggregator
    await FRAX.connect(user2.signer).approve(aggregator.address, depositAmount);

    //Deposit
    await aggregator.connect(user2.signer).deposit(depositAmount, user2.address);

    expect(await FRAX.balanceOf(user2.address)).to.be.eq(0);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(depositAmount.mul(3).div(2));
    expect(await aggregator.balanceOf(user2.address)).to.be.eq(depositAmount);
  });

  it('Admin run manualAllocation', async () => {
    const { users, FRAX } = testEnv;
    admin = users[0];
    const lendAmount = await convertToCurrencyDecimals(FRAX.address, '15000');
    const positions = [
      {
        lender: crvLender.address,
        share: 530
      },
      {
        lender: cvxLender.address,
        share: 470
      }
    ]
    const beforeFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const beforeFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);

    // APR check
    const crvLenderAPR = await crvLender.apr();
    const cvxLenderAPR = await cvxLender.apr();
    expect(crvLenderAPR).to.be.gt(cvxLenderAPR);

    // APRAfterDeposit check
    expect(await crvLender.aprAfterDeposit(lendAmount)).to.be.lt(crvLenderAPR);

    //adjustPosition
    await aggregator.connect(admin.signer).manualAllocation(positions);

    const afterFRAXAmountOfHighPair = await FRAX.balanceOf(FRAX_CRV_PAIR_ADDRESS);
    const afterFRAXAmountOfLowPair = await FRAX.balanceOf(FRAX_CVX_PAIR_ADDRESS);
    expect(await FRAX.balanceOf(aggregator.address)).to.be.eq(0);
    expect(await aggregator.totalAssets()).to.be.eq(lendAmount.sub(2));
    expect(await aggregator.convertToAssets(lendAmount)).to.be.eq(lendAmount.sub(2));
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.gt(
      lendAmount.div(2)
    );
    expect(afterFRAXAmountOfHighPair.sub(beforeFRAXAmountOfHighPair)).to.be.lt(
      lendAmount.div(15).mul(8)
    );
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.gt(
      lendAmount.div(15).mul(7)
    );
    expect(afterFRAXAmountOfLowPair.sub(beforeFRAXAmountOfLowPair)).to.be.lt(
      lendAmount.div(15).mul(8)
    );
  });
});
