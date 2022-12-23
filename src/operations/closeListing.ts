import {
  CloseListingInstructionAccounts,
  createCloseListingInstruction,
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

const Key = 'CloseListingOperation' as const;

export type CloseListingInput = {
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  seller?: Signer;
} & BaseInput;

export type CloseListingOutput = {} & BaseOutput;

export type CloseListingOperation = Operation<typeof Key, CloseListingInput, CloseListingOutput>;

export const closeListingOperation = useOperation<CloseListingOperation>(Key);

export const closeListingOperationHandler: OperationHandler<CloseListingOperation> = {
  async handle(
    operation: CloseListingOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<CloseListingOutput> {
    const builder = await closeListingBuilder(metaplex, operation.input, scope);
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

export type CloseListingBuilderParams = Omit<CloseListingInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type CloseListingBuilderContext = Omit<CloseListingOutput, 'response' | 'closeListing'>;

export const closeListingBuilder = async (
  metaplex: Metaplex,
  {
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
    seller: _seller,
  }: CloseListingBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<CloseListingBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const seller = _seller ?? (metaplex.identity() as Signer);
  const sellerPublicKey = toPublicKey(seller);

  const sellerTradeState = metaplex.rewardCenter().pdas().auctioneerTradeStateAddress({
    auctionHouse,
    tokenAccount: associatedTokenAccount,
    tokenMint,
    tokenSize: 1,
    treasuryMint: auctionHouseTreasuryMint,
    wallet: sellerPublicKey,
  });

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

  const accounts: CloseListingInstructionAccounts = {
    wallet: seller.publicKey,
    tokenAccount: associatedTokenAccount,
    metadata,
    authority: auctionHouseAuthority,
    rewardCenter,
    auctionHouse,
    auctionHouseFeeAccount,
    ahAuctioneerPda: auctioneer,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
    listing: listingAddress,
    tokenMint,
    tradeState: sellerTradeState,
  };

  const builder = TransactionBuilder.make<CloseListingBuilderContext>()
    .setFeePayer(payer)
    .setContext({});

  builder.add({
    instruction: createCloseListingInstruction(accounts),
    signers: [seller],
    key: 'closeListing',
  });

  return builder;
};
