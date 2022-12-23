import {
  createListingOperation,
  createListingOperationHandler,
  Metaplex,
  MetaplexPlugin,
  Program,
  ProgramClient,
} from '@metaplex-foundation/js';
import { acceptOfferOperation, acceptOfferOperationHandler } from './operations/acceptOffer';
import { buyOperation, buyOperationHandler } from './operations/buy';
import { cancelOfferOperation, cancelOfferOperationHandler } from './operations/cancelOffer';
import { closeListingOperation, closeListingOperationHandler } from './operations/closeListing';
import { makeOfferOperation, makeOfferOperationHandler } from './operations/makeOffer';
import { updateListingOperation, updateListingOperationHandler } from './operations/updateListing';
import { updateOfferOperation, updateOfferOperationHandler } from './operations/updateOffer';
import { RewardCenterClient } from './RewardCenterClient';

export const registerRewardCenter = (rewardCenterProgram: Program): MetaplexPlugin => ({
  install(metaplex: Metaplex) {
    // Program
    metaplex.programs().register(rewardCenterProgram);
    metaplex.programs().getRewardCenter = function (this: ProgramClient, programs?: Program[]) {
      return this.get(rewardCenterProgram.name, programs);
    };

    // Operations
    const op = metaplex.operations();
    op.register(acceptOfferOperation, acceptOfferOperationHandler);
    op.register(buyOperation, buyOperationHandler);
    op.register(cancelOfferOperation, cancelOfferOperationHandler);
    op.register(closeListingOperation, closeListingOperationHandler);
    op.register(createListingOperation, createListingOperationHandler);
    op.register(makeOfferOperation, makeOfferOperationHandler);
    op.register(updateListingOperation, updateListingOperationHandler);
    op.register(updateOfferOperation, updateOfferOperationHandler);

    // Client
    const client = new RewardCenterClient(metaplex);
    metaplex.rewardCenter = () => client;
  },
});

declare module '@metaplex-foundation/js' {
  interface Metaplex {
    rewardCenter(): RewardCenterClient;
  }
}

declare module '@metaplex-foundation/js' {
  interface ProgramClient {
    getRewardCenter(programs?: Program[]): Program;
  }
}
