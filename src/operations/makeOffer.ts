import {
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
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, Token } from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction, Signer as SolanaSigner } from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';
import { toLamports } from '../utility/sol';

const Key = 'MakeOfferOperation' as const;

export type MakeOfferInput = {
  amount: string;
  auctionHouse: PublicKey;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  rewardCenterToken: PublicKey;
  buyer?: Signer;
} & BaseInput;

export type MakeOfferOutput = {
  buyerTradeState: PublicKey;
  metadata: PublicKey;
  buyerTradeStateBump: number;
  associatedTokenAccount: PublicKey;
  buyerPrice: number;
} & BaseOutput;

export type MakeOfferOperation = Operation<typeof Key, MakeOfferInput, MakeOfferOutput>;

export const makeOfferOperation = useOperation<MakeOfferOperation>(Key);

export const makeOfferOperationHandler: OperationHandler<MakeOfferOperation> = {
  async handle(
    operation: MakeOfferOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<MakeOfferOutput> {
    const builder = await makeOfferBuilder(metaplex, operation.input, scope);
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

export type MakeOfferBuilderParams = Omit<MakeOfferInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type MakeOfferBuilderContext = Omit<MakeOfferOutput, 'response' | 'offer'>;

export const makeOfferBuilder = async (
  metaplex: Metaplex,
  {
    amount,
    buyer: _buyer,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
    rewardCenterToken,
  }: MakeOfferBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<MakeOfferBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const buyer = _buyer ?? (metaplex.identity() as Signer);
  const buyerPrice = toLamports(Number(amount));

  const escrowPaymentAccount = metaplex
    .auctionHouse()
    .pdas()
    .buyerEscrow({ auctionHouse, buyer: toPublicKey(buyer), programs });

  const buyerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: toBigNumber(buyerPrice),
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

  const accounts: CreateOfferInstructionAccounts = {
    wallet: buyer.publicKey,
    offer,
    paymentAccount: buyer.publicKey,
    transferAuthority: buyer.publicKey,
    treasuryMint: auctionHouseTreasuryMint,
    tokenAccount: associatedTokenAccount,
    metadata,
    escrowPaymentAccount,
    authority: auctionHouseAuthority,
    rewardCenter,
    auctionHouse,
    auctionHouseFeeAccount,
    buyerTradeState,
    ahAuctioneerPda: auctioneer,
    auctionHouseProgram: metaplex.programs().getAuctionHouse().address,
  };

  const args: CreateOfferInstructionArgs = {
    createOfferParams: {
      tradeStateBump: buyerTradeState.bump,
      escrowPaymentBump: escrowPaymentAccount.bump,
      buyerPrice,
      tokenSize: 1,
    },
  };

  const buyerRewardTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    buyer.publicKey,
    true
  );

  const buyerATAInstruction = Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    buyerRewardTokenAccount,
    buyer.publicKey,
    buyer.publicKey
  );

  const buyerAtAInfo = await metaplex.connection.getAccountInfo(buyerRewardTokenAccount);

  const builder = TransactionBuilder.make<MakeOfferBuilderContext>().setFeePayer(payer).setContext({
    buyerTradeState,
    metadata,
    buyerTradeStateBump: buyerTradeState.bump,
    associatedTokenAccount,
    buyerPrice,
  });

  if (!buyerAtAInfo) {
    builder.add({
      instruction: buyerATAInstruction,
      signers: [buyer],
      key: 'buyerATA',
    });
  }

  builder.add({
    instruction: createCreateOfferInstruction(accounts, args),
    signers: [buyer],
    key: 'makeOffer',
  });

  return builder;
};
