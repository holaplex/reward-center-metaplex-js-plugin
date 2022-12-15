import { Connection } from '@solana/web3.js';
import { createContext } from 'react';
import { Metaplex } from '@metaplex-foundation/js/dist/types/Metaplex';
import { registerRewardCenter } from '../plugin';
import { rewardCenterProgram } from '../program';

interface IMetaplexContext {
  /**
   * metaplex instance
   */
  metaplex: Metaplex;
}

export const MetaplexContext = createContext<IMetaplexContext | null>(null);

interface MetaplexProviderProps {
  children: JSX.Element[];
  connection: Connection;
}

export default function MetaplexProvider(props: MetaplexProviderProps): JSX.Element {
  const metaplex = new Metaplex(props.connection);

  const plugin = registerRewardCenter(rewardCenterProgram);
  metaplex.use(plugin);

  return <MetaplexContext.Provider value={{ metaplex }}>{props.children}</MetaplexContext.Provider>;
}
