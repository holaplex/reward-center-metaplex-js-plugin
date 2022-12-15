import { useContext } from 'react';
import { MetaplexContext } from '../providers/MetaplexProvider';

export function useMetaplex() {
  const context = useContext(MetaplexContext);

  if (context === null) {
    throw new Error('Metaplex Context not available');
  }

  return context;
}
