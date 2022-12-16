import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export type BaseInput = {
  auctionHouse: PublicKey;
  addressLookupTable: PublicKey;
  signTransaction: <T extends VersionedTransaction | Transaction>(transaction: T) => Promise<T>;
};
