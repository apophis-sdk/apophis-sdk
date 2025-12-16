import { type IKeyValueStorage } from '@walletconnect/keyvaluestorage';
import { type SignClientTypes } from '@walletconnect/types';

export interface WalletConnectSignerConfig {
  projectId: string;
  /** Whether to exclude default styles. Defaults to false. */
  unstyled?: boolean;
  /** Class name to append to the WalletConnect modal. Useful for overriding styles (default styles
   * will not scope to this class name, such that you can use it to increase specificity).
   */
  modalClassName?: string;
  /** Metadata to pass to WalletConnect. */
  metadata?: SignClientTypes.Metadata;
  /** Encoding to use for signing. Defaults to 'base64'. */
  encoding?: 'base64' | 'hex';
  /** Optional storage passed to the WalletConnect SignClient. A default implementation exists
   * within WalletConnect, but may change in the future. Currently, the default implementation is
   * based on IndexedDB.
   *
   * Apophis uses this storage internally as well to store account information.
   */
  storage?: IKeyValueStorage;
}
