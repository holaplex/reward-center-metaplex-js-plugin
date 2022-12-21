import {
  createUpdateListingInstruction,
  UpdateListingInstructionAccounts,
  UpdateListingInstructionArgs,
} from '@holaplex/hpl-reward-center';
import {
  makeConfirmOptionsFinalizedOnMainnet,
  Metaplex,
  Operation,
  OperationHandler,
  OperationScope,
  PublicKey,
  Signer,
  toPublicKey,
  TransactionBuilder,
  TransactionBuilderOptions,
  useOperation,
} from '@metaplex-foundation/js';
import { TransactionMessage, VersionedTransaction, Signer as SolanaSigner } from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';
import { toLamports } from '../utility/sol';

const Key = 'UpdateListingOperation' as const;

export type UpdateListingInput = {
  amount: string;
  auctionHouse: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  seller?: Signer;
} & BaseInput;

export type UpdateListingOutput = {
  buyerPrice: number;
} & BaseOutput;

export type UpdateListingOperation = Operation<typeof Key, UpdateListingInput, UpdateListingOutput>;

export const updateListingOperation = useOperation<UpdateListingOperation>(Key);

export const updateListingOperationHandler: OperationHandler<UpdateListingOperation> = {
  async handle(
    operation: UpdateListingOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<UpdateListingOutput> {
    const builder = await updateListingBuilder(metaplex, operation.input, scope);
    const { blockhash, lastValidBlockHeight } = await metaplex.connection.getLatestBlockhash();

    const lookupTableAccount = await metaplex.connection
      .getAddressLookupTable(operation.input.addressLookupTable)
      .then((res) => res.value);

    const messageV0 = new TransactionMessage({
      payerKey: builder.getFeePayer()!.publicKey,
      recentBlockhash: blockhash,
      instructions: builder.getInstructions(),
    }).compileToV0Message([lookupTableAccount!]);

    const transactionV0 = new VersionedTransaction(messageV0);

    // Metaplex sdk's Signer type is different than Solana/Web3 Signer type.
    transactionV0.sign(builder.getSigners() as SolanaSigner[]);

    const confirmOptions = makeConfirmOptionsFinalizedOnMainnet(metaplex, scope.confirmOptions);

    const signature = await metaplex.connection.sendRawTransaction(
      transactionV0.serialize(),
      confirmOptions
    );

    const response = await metaplex
      .rpc()
      .confirmTransaction(
        signature,
        { blockhash, lastValidBlockHeight },
        confirmOptions?.commitment
      );

    const output = {
      response,
      ...builder.getContext(),
    };

    scope.throwIfCanceled();

    return output;
  },
};

// -----------------
// Builder
// -----------------

export type UpdateListingBuilderParams = Omit<UpdateListingInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type UpdateListingBuilderContext = Omit<UpdateListingOutput, 'response' | 'updateListing'>;

export const updateListingBuilder = async (
  metaplex: Metaplex,
  {
    amount,
    auctionHouse,
    metadata,
    associatedTokenAccount,
    seller: _seller,
  }: UpdateListingBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<UpdateListingBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const seller = _seller ?? (metaplex.identity() as Signer);
  const buyerPrice = toLamports(Number(amount));

  const sellerPublicKey = toPublicKey(seller);

  const rewardCenter = metaplex.rewardCenter().pdas().rewardCenter({ auctionHouse });

  const listingAddress = metaplex.rewardCenter().pdas().listingAddress({
    metadata,
    rewardCenter,
    seller: sellerPublicKey,
    programs,
  });

  const auctioneer = metaplex.rewardCenter().pdas().auctioneerAddress({
    auctionHouse,
    rewardCenter,
  });

  const accounts: UpdateListingInstructionAccounts = {
    wallet: seller.publicKey,
    tokenAccount: associatedTokenAccount,
    metadata,
    rewardCenter,
    auctionHouse,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
    listing: listingAddress,
  };

  const args: UpdateListingInstructionArgs = {
    updateListingParams: {
      newPrice: buyerPrice,
    },
  };

  const builder = TransactionBuilder.make<UpdateListingBuilderContext>()
    .setFeePayer(payer)
    .setContext({ buyerPrice });

  builder.add({
    instruction: createUpdateListingInstruction(accounts, args),
    signers: [seller],
    key: 'updateListing',
  });

  return builder;
};
