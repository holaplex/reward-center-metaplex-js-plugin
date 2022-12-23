import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export type BaseInput = {
  auctionHouse: PublicKey;
  addressLookupTable: PublicKey;
};
