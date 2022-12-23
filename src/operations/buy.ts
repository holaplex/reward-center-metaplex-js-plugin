import {
  BuyListingInstructionAccounts,
  BuyListingInstructionArgs,
  createBuyListingInstruction,
} from '@holaplex/hpl-reward-center';
import {
  makeConfirmOptionsFinalizedOnMainnet,
  Metaplex,
  Operation,
  OperationHandler,
  OperationScope,
  Signer,
  toBigNumber,
  toPublicKey,
  TransactionBuilder,
  TransactionBuilderOptions,
  useOperation,
} from '@metaplex-foundation/js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  AccountMeta,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Signer as SolanaSigner,
} from '@solana/web3.js';
import { BaseInput } from '../models/BaseInput';
import { BaseOutput } from '../models/BaseOutput';
import { toLamports } from '../utility/sol';

const Key = 'BuyOperation' as const;

export type BuyInput = {
  listedPrice: string;
  auctionHouseAuthority: PublicKey;
  auctionHouseFeeAccount: PublicKey;
  auctionHouseTreasury: PublicKey;
  auctionHouseTreasuryMint: PublicKey;
  tokenMint: PublicKey;
  metadata: PublicKey;
  associatedTokenAccount: PublicKey;
  rewardCenterToken: PublicKey;
  seller: PublicKey;
  sellerTradeState: PublicKey;
  sellerTradeStateBump: number;
  creators: AccountMeta[];
  buyer?: Signer;
} & BaseInput;

export type BuyOutput = {
  buyerReceiptTokenAccount: PublicKey;
} & BaseOutput;

export type BuyOperation = Operation<typeof Key, BuyInput, BuyOutput>;

export const buyOperation = useOperation<BuyOperation>(Key);

export const buyOperationHandler: OperationHandler<BuyOperation> = {
  async handle(
    operation: BuyOperation,
    metaplex: Metaplex,
    scope: OperationScope
  ): Promise<BuyOutput> {
    const builder = await buyBuilder(metaplex, operation.input, scope);

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

export type BuyBuilderParams = Omit<BuyInput, 'confirmOptions'> & {
  instructionKey?: string;
};

export type BuyBuilderContext = Omit<BuyOutput, 'response' | 'buy'>;

export const buyBuilder = async (
  metaplex: Metaplex,
  {
    listedPrice,
    auctionHouse,
    auctionHouseAuthority,
    auctionHouseFeeAccount,
    auctionHouseTreasury,
    auctionHouseTreasuryMint,
    tokenMint,
    metadata,
    associatedTokenAccount,
    rewardCenterToken,
    seller,
    sellerTradeState,
    sellerTradeStateBump,
    creators,
    buyer: _buyer,
    addressLookupTable,
  }: BuyBuilderParams,
  options: TransactionBuilderOptions = {}
): Promise<TransactionBuilder<BuyBuilderContext>> => {
  const { programs, payer = metaplex.rpc().getDefaultFeePayer() } = options;
  const buyer = _buyer ?? (metaplex.identity() as Signer);
  const price = toLamports(Number(listedPrice));

  const buyerTradeState = metaplex
    .auctionHouse()
    .pdas()
    .tradeState({
      auctionHouse,
      price: toBigNumber(price),
      tokenMint,
      tokenSize: toBigNumber(1),
      treasuryMint: auctionHouseTreasuryMint,
      wallet: toPublicKey(buyer),
      programs,
      tokenAccount: tokenMint,
    });

  const escrowPaymentAccount = metaplex
    .auctionHouse()
    .pdas()
    .buyerEscrow({ auctionHouse, buyer: toPublicKey(buyer), programs });

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
      wallet: seller,
      programs,
      tokenAccount: associatedTokenAccount,
    });

  const buyerReceiptTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    tokenMint,
    buyer.publicKey
  );

  const rewardCenter = metaplex.rewardCenter().pdas().rewardCenter({ auctionHouse });
  const listing = metaplex
    .rewardCenter()
    .pdas()
    .listingAddress({ metadata, rewardCenter, seller, programs });

  const auctioneer = metaplex.rewardCenter().pdas().auctioneerAddress({
    auctionHouse,
    rewardCenter,
  });

  const rewardCenterRewardTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    rewardCenter,
    true
  );

  const buyerRewardTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    buyer.publicKey
  );

  const buyerATAInstruction = Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    buyerRewardTokenAccount,
    buyer.publicKey,
    buyer.publicKey
  );

  const sellerRewardTokenAccount = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    rewardCenterToken,
    seller
  );

  const accounts: BuyListingInstructionAccounts = {
    buyer: toPublicKey(buyer),
    buyerRewardTokenAccount,
    seller,
    sellerRewardTokenAccount,
    listing,
    tokenAccount: associatedTokenAccount,
    paymentAccount: toPublicKey(buyer),
    transferAuthority: toPublicKey(buyer),
    tokenMint,
    metadata,
    treasuryMint: auctionHouseTreasuryMint,
    sellerPaymentReceiptAccount: seller,
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

  const args: BuyListingInstructionArgs = {
    buyListingParams: {
      escrowPaymentBump: escrowPaymentAccount.bump,
      freeTradeStateBump: freeSellerTradeState.bump,
      sellerTradeStateBump,
      programAsSignerBump: programAsSigner.bump,
      buyerTradeStateBump: buyerTradeState.bump,
    },
  };

  const buyListingIx = createBuyListingInstruction(accounts, args);
  const keys = buyListingIx.keys.concat(creators);

  const buyerAtAInfo = await metaplex.connection.getAccountInfo(buyerRewardTokenAccount);

  const builder = TransactionBuilder.make<BuyBuilderContext>().setFeePayer(payer).setContext({
    buyerReceiptTokenAccount,
  });

  const ix = ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 });

  builder.add({
    instruction: ix,
    signers: [buyer],
    key: 'setComputeUnitLimit',
  });

  if (!buyerAtAInfo) {
    builder.add({
      instruction: buyerATAInstruction,
      signers: [buyer],
      key: 'buyerATA',
    });
  }

  builder.add({
    instruction: new TransactionInstruction({
      programId: metaplex.programs().getRewardCenter().address,
      data: buyListingIx.data,
      keys,
    }),
    signers: [buyer],
    key: 'buyListing',
  });

  return builder;
};
