import * as fs from 'fs';
import * as path from 'path';

interface AbiError {
  type: 'error';
  name: string;
  inputs: Array<{
    name: string;
    type: string;
    internalType: string;
  }>;
}

interface AbiItem {
  type: string;
  name?: string;
  [key: string]: any;
}

// ERC20 errors from OpenZeppelin's draft-IERC6093
const ERC20_ERRORS: AbiError[] = [
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' }
    ]
  },
  {
    type: 'error',
    name: 'ERC20InvalidSender',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' }
    ]
  },
  {
    type: 'error',
    name: 'ERC20InvalidReceiver',
    inputs: [
      { name: 'receiver', type: 'address', internalType: 'address' }
    ]
  },
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'allowance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' }
    ]
  },
  {
    type: 'error',
    name: 'ERC20InvalidApprover',
    inputs: [
      { name: 'approver', type: 'address', internalType: 'address' }
    ]
  },
  {
    type: 'error',
    name: 'ERC20InvalidSpender',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' }
    ]
  },
  // SafeERC20 specific error
  {
    type: 'error',
    name: 'SafeERC20FailedOperation',
    inputs: [
      { name: 'token', type: 'address', internalType: 'address' }
    ]
  }
];

// Contracts that use SafeERC20
const CONTRACTS_USING_SAFE_ERC20: string[] = [
  'TermRepoLocker.json',
  'TermStrategyFacet.json',
  'TransferFacet.json',
  'TermFlashLoanExecutor.json',
  'TermMorphoInterfaceFacet.json',
  'TermAaveInterfaceFacet.json',
  'TermFlashLoanCentralReceiverFacet.json',
  'TermLoanIntentFacet.json',
  'TermLoanIntentHookFacet.json',
  'TermRepoTokenIntentFacet.json',
  'TermRouterFacet.json',
  'SwapRouterFacet.json',
  'ERC4626InterfaceFacet.json',
  'WETHWrappingFacet.json',
  'Permit2Facet.json',
  'PermitFacet.json'
];

async function mergeERC20Errors(): Promise<void> {
  const abiDir = path.join(__dirname, '../abi');

  for (const filename of CONTRACTS_USING_SAFE_ERC20) {
    const filepath = path.join(abiDir, filename);

    if (fs.existsSync(filepath)) {
      const abiContent = fs.readFileSync(filepath, 'utf8');
      const abi: AbiItem[] = JSON.parse(abiContent);

      // Check if errors already exist
      const existingErrorNames = abi
        .filter((item): item is AbiError => item.type === 'error')
        .map(item => item.name);

      // Add missing ERC20 errors
      const errorsToAdd = ERC20_ERRORS.filter(
        error => !existingErrorNames.includes(error.name)
      );

      if (errorsToAdd.length > 0) {
        const updatedAbi = [...abi, ...errorsToAdd];
        fs.writeFileSync(filepath, JSON.stringify(updatedAbi, null, 2));
        console.log(`Added ${errorsToAdd.length} ERC20 errors to ${filename}`);
      } else {
        console.log(`${filename} already has all ERC20 errors`);
      }
    } else {
      console.log(`Warning: ${filename} not found`);
    }
  }

  console.log('ERC20 error merging complete');
}

// Execute if run directly
if (require.main === module) {
  mergeERC20Errors().catch(error => {
    console.error('Error merging ERC20 errors:', error);
    process.exit(1);
  });
}

export { mergeERC20Errors };