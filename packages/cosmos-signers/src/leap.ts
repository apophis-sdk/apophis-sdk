import { createKeplrSigner } from './keplr.js';
import LOGO_DATA_URL from './logos/leap.js';

// leap's types library is broken & I cba to monkeypatch it
declare global {
  interface Window {
    leap?: any;
  }
}

export const createLeapSigner = () => createKeplrSigner({
  type: 'Leap',
  displayName: 'Leap',
  logoURL: LOGO_DATA_URL,
  getBackend: () => typeof window !== 'undefined' ? window.leap : undefined,
  probe: () => typeof window !== 'undefined' && !!window.leap,
  keystoreChangeEvent: 'leap_keystorechange',
});

export const Leap = createLeapSigner();
