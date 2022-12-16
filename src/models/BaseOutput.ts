import {
  ConfirmTransactionResponse,
  SendAndConfirmTransactionResponse,
} from '@metaplex-foundation/js';

export type BaseOutput = {
  /** The blockchain response from confirming the transaction. */
  response: ConfirmTransactionResponse;
};
