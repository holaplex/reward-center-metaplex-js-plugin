import {
  CloseOfferInstructionAccounts,
  CloseOfferInstructionArgs,
  createCloseOfferInstruction,
  createCreateOfferInstruction,
  CreateOfferInstructionAccounts,
  CreateOfferInstructionArgs,
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
import { TransactionMessage, VersionedTransaction, Signer as SolanaSigner } from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';
import { toLamports } from '../utility/sol';

const Key = 'UpdateOfferOperation' as const;

export type UpdateOfferInput = {
  currentOfferPrice: string;
  newOfferPrice: string;
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  buyer?: Signer;
} & BaseInput;

export type UpdateOfferOutput = {} & BaseOutput;

export type UpdateOfferOperation = Operation<typeof Key, UpdateOfferInput, UpdateOfferOutput>;

export const updateOfferOperation = useOperation<UpdateOfferOperation>(Key);

export const makeOfferOperationHandler: OperationHandler<UpdateOfferOperation> = {
  async handle(
    operation: UpdateOfferOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<UpdateOfferOutput> {
    const builder = await updateOfferBuilder(metaplex, operation.input, scope);
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

export type UpdateOfferBuilderParams = Omit<UpdateOfferInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type UpdateOfferBuilderContext = Omit<UpdateOfferOutput, 'response' | 'updateOffer'>;

export const updateOfferBuilder = async (
  metaplex: Metaplex,
  {
    currentOfferPrice,
    newOfferPrice,
    buyer: _buyer,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
  }: UpdateOfferBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<UpdateOfferBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const buyer = _buyer ?? (metaplex.identity() as Signer);
  const currentPrice = toBigNumber(toLamports(Number(currentOfferPrice)));
  const newPrice = toBigNumber(toLamports(Number(newOfferPrice)));

  const escrowPaymentAccount = metaplex
    .auctionHouse()
    .pdas()
    .buyerEscrow({ auctionHouse, buyer: toPublicKey(buyer), programs });

  const buyerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: currentPrice,
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: toPublicKey(buyer),
      programs,
      tokenAccount: tokenMint,
    });

  const updateBuyerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: newPrice,
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: toPublicKey(buyer),
      programs,
      tokenAccount: tokenMint,
    });

  const rewardCenter = metaplex.rewardCenter().pdas().rewardCenter({ auctionHouse });

  const offer = metaplex
    .rewardCenter()
    .pdas()
    .offerAddress({ buyer: buyer.publicKey, metadata, rewardCenter });

  const auctioneer = metaplex.rewardCenter().pdas().auctioneerAddress({
    auctionHouse,
    rewardCenter,
  });

  const closeOfferAccounts: CloseOfferInstructionAccounts = {
    wallet: buyer.publicKey,
    offer,
    treasuryMint: auctionHouseTreasuryMint,
    tokenAccount: associatedTokenAccount,
    receiptAccount: buyer.publicKey,
    tokenMint,
    tradeState: buyerTradeState,
    metadata,
    escrowPaymentAccount,
    authority: auctionHouseAuthority,
    rewardCenter,
    auctionHouse,
    auctionHouseFeeAccount,
    ahAuctioneerPda: auctioneer,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
  };

  const closeOfferArgs: CloseOfferInstructionArgs = {
    closeOfferParams: {
      escrowPaymentBump: escrowPaymentAccount.bump,
    },
  };

  const createofferAccounts: CreateOfferInstructionAccounts = {
    wallet: buyer.publicKey,
    offer,
    paymentAccount: buyer.publicKey,
    transferAuthority: buyer.publicKey,
    treasuryMint: auctionHouseTreasuryMint,
    tokenAccount: associatedTokenAccount,
    metadata,
    escrowPaymentAccount: escrowPaymentAccount,
    authority: auctionHouseAuthority,
    rewardCenter,
    auctionHouse: auctionHouse,
    auctionHouseFeeAccount: auctionHouseFeeAccount,
    buyerTradeState: updateBuyerTradeState,
    ahAuctioneerPda: auctioneer,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
  };

  const createOfferArgs: CreateOfferInstructionArgs = {
    createOfferParams: {
      tradeStateBump: updateBuyerTradeState.bump,
      escrowPaymentBump: escrowPaymentAccount.bump,
      buyerPrice: newPrice,
      tokenSize: 1,
    },
  };

  const builder = TransactionBuilder.make<UpdateOfferBuilderContext>()
    .setFeePayer(payer)
    .setContext({});

  builder.add({
    instruction: createCloseOfferInstruction(closeOfferAccounts, closeOfferArgs),
    signers: [buyer],
    key: 'closeOffer',
  });

  builder.add({
    instruction: createCreateOfferInstruction(createofferAccounts, createOfferArgs),
    signers: [buyer],
    key: 'createOffer',
  });

  return builder;
};
