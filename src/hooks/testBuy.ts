import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useState } from 'react';

import { PublicKey, AccountMeta } from '@solana/web3.js';
import { Signer, walletAdapterIdentity } from '@metaplex-foundation/js';
import { useMetaplex } from '../hooks/metaplex';
import { BuyInput, BuyOutput } from '../operations/buy';
import { OperationResponse } from '../models/OperationResponse';

interface BuyListingResponse {
  buyerReceiptTokenAccount: PublicKey;
}

interface BuyContext {
  buy: boolean;
  buying: boolean;
  onBuyNow: (buyInput: BuyInput) => Promise<OperationResponse<BuyOutput>>;
  onOpenBuy: () => void;
  onCloseBuy: () => void;
}

export default function useBuyNow(): BuyContext {
  const wallet = useWallet();
  const { connected, publicKey, signTransaction, signAllTransactions, signMessage } = wallet;
  const [buy, setBuy] = useState(false);
  const [buying, setBuying] = useState(false);
  const { metaplex } = useMetaplex();

  const onBuyNow = async (buyInput: BuyInput) => {
    if (!connected || !publicKey || !signTransaction || !signAllTransactions || !signMessage) {
      throw new Error('not all params provided');
    }

    setBuying(true);

    metaplex.use(walletAdapterIdentity(wallet));

    metaplex.rpc().setDefaultFeePayer({
      publicKey,
      signTransaction,
      signAllTransactions,
      signMessage,
    } as Signer);

    try {
      const result = await metaplex.rewardCenter().buy(buyInput);

      return { result };
    } catch (err: any) {
      return { error: err };
    } finally {
      setBuying(false);
      setBuy(false);
    }
  };

  const onOpenBuy = useCallback(() => {
    setBuy(true);
  }, [setBuy]);

  const onCloseBuy = useCallback(() => {
    setBuy(false);
  }, [setBuy]);

  return {
    buy,
    buying,
    onBuyNow,
    onOpenBuy,
    onCloseBuy,
  };
}
