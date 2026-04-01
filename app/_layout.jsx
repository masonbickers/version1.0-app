// app/_layout.jsx
import { Stack } from "expo-router";
import React from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AuthProvider } from "../providers/AuthProvider";
import { LiveActivityProvider } from "../providers/LiveActivityProvider";
import { ThemeProvider } from "../providers/ThemeProvider";

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[root-startup-error]", error, info?.componentStack || "");
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#050506" }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 20,
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "800" }}>
            Startup error
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>
            The app hit an error while loading. Please relaunch after updating.
          </Text>
          <Text style={{ color: "#E6FF3B", textAlign: "center" }}>
            {String(this.state.error?.message || this.state.error || "Unknown error")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }
}

export default function RootLayout() {
  return (
    <RootErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <LiveActivityProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </LiveActivityProvider>
        </AuthProvider>
      </ThemeProvider>
    </RootErrorBoundary>
  );
}
