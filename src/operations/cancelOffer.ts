import {
  CloseOfferInstructionAccounts,
  CloseOfferInstructionArgs,
  createCloseOfferInstruction,
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

const Key = 'CancelOfferOperation' as const;

export type CancelOfferInput = {
  currentOfferPrice: string;
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  buyer?: Signer;
} & BaseInput;

export type CancelOfferOutput = {} & BaseOutput;

export type CancelOfferOperation = Operation<typeof Key, CancelOfferInput, CancelOfferOutput>;

export const cancelOfferOperation = useOperation<CancelOfferOperation>(Key);

export const cancelOfferOperationHandler: OperationHandler<CancelOfferOperation> = {
  async handle(
    operation: CancelOfferOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<CancelOfferOutput> {
    const builder = await cancelOfferBuilder(metaplex, operation.input, scope);
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

export type CancelOfferBuilderParams = Omit<CancelOfferInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type CancelOfferBuilderContext = Omit<CancelOfferOutput, 'response' | 'cancelOffer'>;

export const cancelOfferBuilder = async (
  metaplex: Metaplex,
  {
    currentOfferPrice,
    buyer: _buyer,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
  }: CancelOfferBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<CancelOfferBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const buyer = _buyer ?? (metaplex.identity() as Signer);
  const currentPrice = toBigNumber(toLamports(Number(currentOfferPrice)));

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

  const builder = TransactionBuilder.make<CancelOfferBuilderContext>()
    .setFeePayer(payer)
    .setContext({});

  builder.add({
    instruction: createCloseOfferInstruction(closeOfferAccounts, closeOfferArgs),
    signers: [buyer],
    key: 'closeOffer',
  });

  return builder;
};
