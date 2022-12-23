import {
  createCreateListingInstruction,
  CreateListingInstructionAccounts,
  CreateListingInstructionArgs,
} from '@holaplex/hpl-reward-center';
import {
  makeConfirmOptionsFinalizedOnMainnet,
  Metaplex,
  Operation,
  OperationHandler,
  OperationScope,
  PublicKey,
  Signer,
  toBigNumber,
  toPublicKey,
  TransactionBuilder,
  TransactionBuilderOptions,
  useOperation,
} from '@metaplex-foundation/js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction, Signer as SolanaSigner } from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';

const Key = 'ListOperation' as const;

export type CreateListingInput = {
  amount: string;
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  rewardCenterToken: PublicKey;
  seller?: Signer;
} & BaseInput;

export type CreateListingOutput = {
  listingAddress: PublicKey;
  sellerTradeState: PublicKey;
  tradeStateBump: number;
  buyerPrice: string;
} & BaseOutput;

export type CreateListingOperation = Operation<typeof Key, CreateListingInput, CreateListingOutput>;

export const createListingOperation = useOperation<CreateListingOperation>(Key);

export const createListingOperationHandler: OperationHandler<CreateListingOperation> = {
  async handle(
    operation: CreateListingOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<CreateListingOutput> {
    const builder = await createListingBuilder(metaplex, operation.input, scope);
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

export type CreateListingBuilderParams = Omit<CreateListingInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type CreateListingBuilderContext = Omit<CreateListingOutput, 'response' | 'createListing'>;

export const createListingBuilder = async (
  metaplex: Metaplex,
  {
    amount,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
    rewardCenterToken,
    seller: _seller,
  }: CreateListingBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<CreateListingBuilderContext>> => {
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

  const programAsSigner = metaplex.auctionHouse().pdas().programAsSigner({ programs });

  const freeSellerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: toBigNumber(0),
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: sellerPublicKey,
      tokenAccount: associatedTokenAccount,
      programs,
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

  const accounts: CreateListingInstructionAccounts = {
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
    sellerTradeState,
    freeSellerTradeState,
    programAsSigner,
  };

  const args: CreateListingInstructionArgs = {
    createListingParams: {
      tradeStateBump: sellerTradeState.bump,
      freeTradeStateBump: freeSellerTradeState.bump,
      programAsSignerBump: programAsSigner.bump,
      price: toBigNumber(amount),
      tokenSize: 1,
    },
  };

  const sellerRewardTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    sellerPublicKey
  );

  const sellerATAInstruction = Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    sellerRewardTokenAccount,
    sellerPublicKey,
    sellerPublicKey
  );

  const sellerAtAInfo = await metaplex.connection.getAccountInfo(sellerRewardTokenAccount);

  const builder = TransactionBuilder.make<CreateListingBuilderContext>()
    .setFeePayer(payer)
    .setContext({
      listingAddress,
      sellerTradeState,
      tradeStateBump: sellerTradeState.bump,
      buyerPrice: amount,
    });

  if (!sellerAtAInfo) {
    builder.add({
      instruction: sellerATAInstruction,
      signers: [seller],
      key: 'sellerATA',
    });
  }

  builder.add({
    instruction: createCreateListingInstruction(accounts, args),
    signers: [seller],
    key: 'createListing',
  });

  return builder;
};
