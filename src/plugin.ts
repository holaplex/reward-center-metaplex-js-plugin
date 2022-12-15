import { Metaplex, MetaplexPlugin, Program, ProgramClient } from '@metaplex-foundation/js';
import { makeOfferOperation, makeOfferOperationHandler } from './operations/makeOffer';
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
    op.register(makeOfferOperation, makeOfferOperationHandler);

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
