import {
  AcceptOfferInstructionAccounts,
  AcceptOfferInstructionArgs,
  CloseListingInstructionAccounts,
  createAcceptOfferInstruction,
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
  toBigNumber,
  toPublicKey,
  TransactionBuilder,
  TransactionBuilderOptions,
  useOperation,
} from '@metaplex-foundation/js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import {
  AccountMeta,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Signer as SolanaSigner,
} from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';
import { toLamports } from '../utility/sol';

const Key = 'AcceptOfferOperation' as const;

export type AcceptOfferInput = {
  amount: string;
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasury: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  rewardCenterToken: PublicKey;
  offerBuyer: PublicKey;
  creators: AccountMeta[];
  seller?: Signer;
} & BaseInput;

export type AcceptOfferOutput = {
  buyerTradeState: PublicKey;
  metadata: PublicKey;
  buyerReceiptTokenAccount: PublicKey;
} & BaseOutput;

export type AcceptOfferOperation = Operation<typeof Key, AcceptOfferInput, AcceptOfferOutput>;

export const acceptOfferOperation = useOperation<AcceptOfferOperation>(Key);

export const acceptOfferOperationHandler: OperationHandler<AcceptOfferOperation> = {
  async handle(
    operation: AcceptOfferOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<AcceptOfferOutput> {
    const builder = await acceptOfferBuilder(metaplex, operation.input, scope);

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

export type AcceptOfferBuilderParams = Omit<AcceptOfferInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type AcceptOfferBuilderContext = Omit<AcceptOfferOutput, 'response' | 'acceptOffer'>;

export const acceptOfferBuilder = async (
  metaplex: Metaplex,
  {
    amount,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasury,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
    rewardCenterToken,
    offerBuyer,
    creators,
    seller: _seller,
  }: AcceptOfferBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<AcceptOfferBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const seller = _seller ?? (metaplex.identity() as Signer);
  const sellerPublicKey = toPublicKey(seller);
  const buyerPrice = toLamports(Number(amount));

  const escrowPaymentAccount = metaplex
    .auctionHouse()
    .pdas()
    .buyerEscrow({ auctionHouse, buyer: offerBuyer, programs });

  const buyerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: toBigNumber(buyerPrice),
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: offerBuyer,
      programs,
      tokenAccount: tokenMint,
    });

  const sellerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: toBigNumber(buyerPrice),
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: sellerPublicKey,
      programs,
      tokenAccount: tokenMint,
    });

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
      programs,
      tokenAccount: associatedTokenAccount,
    });

  const programAsSigner = metaplex.auctionHouse().pdas().programAsSigner({ programs });

  const rewardCenter = metaplex.rewardCenter().pdas().rewardCenter({ auctionHouse });

  const offer = metaplex
    .rewardCenter()
    .pdas()
    .offerAddress({ buyer: offerBuyer, metadata, rewardCenter });

  const auctioneer = metaplex.rewardCenter().pdas().auctioneerAddress({
    auctionHouse,
    rewardCenter,
  });

  const rewardCenterRewardTokenAccount = await getAssociatedTokenAddress(
    rewardCenterToken,
    rewardCenter,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const buyerReceiptTokenAccount = await getAssociatedTokenAddress(
    tokenMint,
    offerBuyer,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const sellerRewardTokenAccount = await getAssociatedTokenAddress(
    rewardCenterToken,
    sellerPublicKey,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const sellerATAInstruction = createAssociatedTokenAccountInstruction(
    sellerPublicKey,
    sellerRewardTokenAccount,
    sellerPublicKey,
    rewardCenterToken,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const buyerRewardTokenAccount = await getAssociatedTokenAddress(
    rewardCenterToken,
    offerBuyer,
    undefined,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const sellerAtAInfo = await metaplex.connection.getAccountInfo(sellerRewardTokenAccount);

  const acceptOfferAccounts: AcceptOfferInstructionAccounts = {
    buyer: offerBuyer,
    buyerRewardTokenAccount,
    seller: sellerPublicKey,
    sellerRewardTokenAccount,
    offer,
    tokenAccount: associatedTokenAccount,
    tokenMint,
    metadata,
    treasuryMint: auctionHouseTreasuryMint,
    sellerPaymentReceiptAccount: sellerPublicKey,
    buyerReceiptTokenAccount,
    authority: auctionHouseAuthority,
    escrowPaymentAccount,
    auctionHouse,
    auctionHouseFeeAccount,
    auctionHouseTreasury,
    sellerTradeState,
    buyerTradeState,
    freeSellerTradeState,
    rewardCenter,
    rewardCenterRewardTokenAccount,
    ahAuctioneerPda: auctioneer,
    programAsSigner,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
  };

  const acceptOfferArgs: AcceptOfferInstructionArgs = {
    acceptOfferParams: {
      escrowPaymentBump: escrowPaymentAccount.bump,
      freeTradeStateBump: freeSellerTradeState.bump,
      sellerTradeStateBump: sellerTradeState.bump,
      programAsSignerBump: programAsSigner.bump,
      buyerTradeStateBump: buyerTradeState.bump,
    },
  };

  const acceptOfferIx = createAcceptOfferInstruction(acceptOfferAccounts, acceptOfferArgs);
  const keys = acceptOfferIx.keys.concat(creators);

  const builder = TransactionBuilder.make<AcceptOfferBuilderContext>()
    .setFeePayer(payer)
    .setContext({
      buyerTradeState,
      metadata,
      buyerReceiptTokenAccount,
    });

  builder.add({
    instruction: ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    signers: [seller],
    key: 'computeUnitLimit',
  });

  const listingAddress = metaplex.rewardCenter().pdas().listingAddress({
    metadata,
    rewardCenter,
    seller: sellerPublicKey,
    programs,
  });

  if (listingAddress) {
    const accounts: CloseListingInstructionAccounts = {
      auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
      listing: listingAddress,
      rewardCenter: rewardCenter,
      wallet: sellerPublicKey,
      tokenAccount: associatedTokenAccount,
      metadata: metadata,
      authority: auctionHouseAuthority,
      auctionHouse,
      auctionHouseFeeAccount,
      tokenMint,
      tradeState: sellerTradeState,
      ahAuctioneerPda: auctioneer,
    };

    const closeListingIx = createCloseListingInstruction(accounts);

    builder.add({
      instruction: closeListingIx,
      signers: [seller],
      key: 'closeListing',
    });
  }

  if (!sellerAtAInfo) {
    builder.add({
      instruction: sellerATAInstruction,
      signers: [seller],
      key: 'sellerATA',
    });
  }

  builder.add({
    instruction: new TransactionInstruction({
      programId: metaplex.programs().getRewardCenter().address,
      data: acceptOfferIx.data,
      keys,
    }),
    signers: [seller],
    key: 'acceptOffer',
  });

  return builder;
};
