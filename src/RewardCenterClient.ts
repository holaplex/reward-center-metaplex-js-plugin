import { Metaplex, OperationOptions } from '@metaplex-foundation/js';
import { AcceptOfferInput, acceptOfferOperation } from './operations/acceptOffer';
import { BuyInput, buyOperation } from './operations/buy';
import { CancelOfferInput, cancelOfferOperation } from './operations/cancelOffer';
import { CloseListingInput, closeListingOperation } from './operations/closeListing';
import { CreateListingInput, createListingOperation } from './operations/createListing';
import { MakeOfferInput, makeOfferOperation } from './operations/makeOffer';
import { UpdateListingInput, updateListingOperation } from './operations/updateListing';
import { UpdateOfferInput, updateOfferOperation } from './operations/updateOffer';
import { RewardCenterPdasClient } from './RewardCenterPdasClient';

export class RewardCenterClient {
  constructor(readonly metaplex: Metaplex) {}

  pdas() {
    return new RewardCenterPdasClient(this.metaplex);
  }

  makeOffer(input: MakeOfferInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(makeOfferOperation(input), options);
  }

  updateOffer(input: UpdateOfferInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(updateOfferOperation(input), options);
  }

  cancelOffer(input: CancelOfferInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(cancelOfferOperation(input), options);
  }

  acceptOffer(input: AcceptOfferInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(acceptOfferOperation(input), options);
  }

  buy(input: BuyInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(buyOperation(input), options);
  }

  createListing(input: CreateListingInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(createListingOperation(input), options);
  }

  updateListing(input: UpdateListingInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(updateListingOperation(input), options);
  }

  closeListing(input: CloseListingInput, options?: OperationOptions) {
    return this.metaplex.operations().execute(closeListingOperation(input), options);
  }
}
