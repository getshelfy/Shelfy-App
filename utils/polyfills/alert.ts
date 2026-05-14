import { Alert } from 'react-native';
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';

// Add global alert() on iOS/Android — it doesn't exist by default in React Native.
// On web, alert.web.ts is used instead (Metro picks .web.ts automatically).
polyfillGlobal('alert', () => (message?: string) => {
  Alert.alert('', String(message ?? ''));
});

declare module 'react-native/Libraries/Utilities/PolyfillFunctions' {
  export function polyfillGlobal(name: string, getValue: () => unknown): void;
}
