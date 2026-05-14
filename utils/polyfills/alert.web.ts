import { Alert } from 'react-native';

// react-native-web's Alert.alert is a no-op, and the iframe preview's Alert
// component isn't visible. Route both Alert.alert and the global alert()
// through window.alert so either API works on web.
Alert.alert = (title?: string, message?: string) => {
  window.alert([title, message].filter(Boolean).join('\n\n'));
};
