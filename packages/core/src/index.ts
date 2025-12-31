import { ProtobufMiddleware } from './encoding/protobuf/any.js';
import { mw } from './middleware.js';

export * from './address.js';
export { Any } from './encoding/protobuf/any.js';
export * from './endpoints.js';
export * from './constants.js';
export * from './jsonrpc.js';
export * from './networks.js';
export * as signals from './signals.js';
export * from './signer.js';
export * from './types.js';

export const DefaultMiddlewares = [
  ProtobufMiddleware,
];

export { mw };

export const Apophis = {
  use: mw.use,
  init: async () => {
    await mw('core', 'init').notify();
  },
};
