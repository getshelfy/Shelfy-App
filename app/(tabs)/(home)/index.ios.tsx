import React from "react";
import { Stack } from "expo-router";
import { StyleSheet, View, Text } from "react-native";
import { useTheme } from "@react-navigation/native";

export default function HomeScreen() {
  const theme = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Building the app...",
        }}
      />
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          Welcome to Newly
        </Text>
        <Text style={[styles.subtitle, { color: theme.dark ? '#98989D' : '#666' }]}>
          Your app is currently building...
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },
});
