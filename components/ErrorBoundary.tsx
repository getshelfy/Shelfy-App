/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree
 * and displays a fallback UI styled similar to React Native's LogBox.
 */

import React, { Component, ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform, SafeAreaView } from "react-native";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showTrace: boolean;
}

/** Extract a readable source location from a stack trace */
function extractSource(stack: string): string | null {
  if (!stack) return null;
  for (const line of stack.split("\n")) {
    const cleanMatch = line.match(/at .+\/((app|components|screens|hooks)\/[^:?)]+):(\d+)/);
    if (cleanMatch) return `${cleanMatch[1]}:${cleanMatch[3]}`;

    const fileMatch = line.match(/at .+\/([^/\s:?)]+\.[jt]sx?):(\d+)/);
    if (fileMatch && !fileMatch[1].includes('.bundle')) return `${fileMatch[1]}:${fileMatch[2]}`;

    const bundleMatch = line.match(/\/([^/]+)\.bundle[^:]*:(\d+):(\d+)/);
    if (bundleMatch) return `${bundleMatch[1]}:${bundleMatch[2]}`;
  }
  return null;
}

interface ComponentFrame {
  name: string;
  source: string | null;
}

/** Extract the component tree with source locations from the component stack */
function extractComponentPath(componentStack: string | undefined): ComponentFrame[] {
  if (!componentStack) return [];
  const components: ComponentFrame[] = [];
  const lines = componentStack.split("\n");
  for (const line of lines) {
    const match = line.match(/at (\w+)(?:\s+\(([^)]+)\))?/);
    if (match && match[1]) {
      const name = match[1];
      if (["RCTView", "View", "RNCSafeAreaProvider", "Unknown"].includes(name)) continue;

      let source: string | null = null;
      if (match[2]) {
        const raw = match[2];
        if (!raw.includes('http') && !raw.includes('.bundle')) {
          source = raw;
        } else {
          const pathMatch = raw.match(/\/([^/]+\.[jt]sx?:\d+:\d+)/);
          if (pathMatch) source = pathMatch[1];
        }
      }

      components.push({ name, source });
    }
    if (components.length >= 6) break;
  }
  return components;
}

/** Extract useful info from Metro bundle URLs in stack traces */
function extractBundleInfo(stack: string): { file: string; line: string; platform: string } | null {
  if (!stack) return null;
  const match = stack.match(/\/([^/]+)\.bundle\?([^:]+):(\d+):(\d+)/);
  if (!match) return null;

  const file = match[1];
  const params = match[2];
  const line = match[3];

  const platformMatch = params.match(/platform=(\w+)/);
  const platform = platformMatch ? platformMatch[1] : "unknown";

  return { file, line, platform };
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showTrace: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
    this.setState({ error, errorInfo });
    this.props.onError?.(error, errorInfo);

    // Notify parent window that ErrorBoundary is now visible (web iframe mode)
    if (Platform.OS === "web" && typeof window !== "undefined" && window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({
          type: "ERROR_BOUNDARY_SHOWN",
          level: "error",
          message: error?.message || "Unknown error",
          data: {
            errorName: error?.name || "Error",
            errorMessage: error?.message || "Unknown error",
            componentStack: errorInfo?.componentStack || "",
            errorStack: error?.stack || "",
          },
          timestamp: new Date().toISOString(),
          source: "error-boundary",
        }, "*");
      } catch (_) {}
    }
  }

  handleReset = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    } else {
      this.setState({ hasError: false, error: null, errorInfo: null, showTrace: false });
    }
  };

  toggleTrace = () => {
    this.setState((s) => ({ showTrace: !s.showTrace }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorStack = this.state.error?.stack || "";
      const componentStack = this.state.errorInfo?.componentStack || "";
      const componentPath = extractComponentPath(componentStack);
      const errorName = this.state.error?.name || "Error";
      const isRenderError = !!componentStack;
      const title = isRenderError ? "Render Error" : "Uncaught Error";

      const firstSource = componentPath.length > 0 ? componentPath[0].source : null;
      const bundleInfo = extractBundleInfo(errorStack || componentStack);

      return (
        <View style={styles.root}>
          {/* Red header bar */}
          <SafeAreaView style={styles.header}>
            <Text style={styles.headerText}>{title}</Text>
          </SafeAreaView>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyInner}>
            {/* Error message */}
            <View style={styles.messageSection}>
              <Text style={styles.errorName}>{errorName}</Text>
              <Text selectable style={styles.errorMessage}>
                {this.state.error?.message || "Unknown error"}
              </Text>
            </View>

            {/* Source info */}
            {(firstSource || bundleInfo) && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Source</Text>
                <View style={styles.sourceCard}>
                  <View style={styles.sourceRow}>
                    <Text style={styles.sourceLabel}>File</Text>
                    <Text selectable style={styles.sourceValue}>
                      {firstSource || bundleInfo?.file || "unknown"}
                    </Text>
                  </View>
                  {bundleInfo && (
                    <View style={[styles.sourceRow, styles.sourceRowBorder]}>
                      <Text style={styles.sourceLabel}>Platform</Text>
                      <Text style={styles.sourceValue}>{bundleInfo.platform}</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Component stack */}
            {componentPath.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Component Stack</Text>
                <View style={styles.componentList}>
                  {componentPath.map((frame, i) => (
                    <View key={i} style={styles.componentRow}>
                      <Text style={styles.componentText}>
                        <Text style={styles.componentBracket}>{"<"}</Text>
                        <Text style={styles.componentName}>{frame.name}</Text>
                        <Text style={styles.componentBracket}>{" />"}</Text>
                      </Text>
                      {frame.source && (
                        <Text selectable style={styles.componentSource}>{frame.source}</Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Call stack — expandable */}
            {errorStack ? (
              <View style={styles.section}>
                <Pressable onPress={this.toggleTrace} style={styles.traceToggle}>
                  <Text style={styles.sectionTitle}>Call Stack</Text>
                  <Text style={styles.chevron}>
                    {this.state.showTrace ? "−" : "+"}
                  </Text>
                </Pressable>
                {this.state.showTrace && (
                  <ScrollView style={styles.traceScroll} nestedScrollEnabled>
                    <Text selectable style={styles.traceText}>{errorStack}</Text>
                  </ScrollView>
                )}
              </View>
            ) : null}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.footerButton, pressed && styles.footerButtonPressed]}
              onPress={this.handleReset}
            >
              {({ pressed }) => (
                <Text style={[styles.footerButtonText, pressed && styles.footerButtonTextPressed]}>
                  Retry
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const HEADER_RED = "#f35369";
const BG = "#1a1a1a";
const BG_LIGHT = "#2a2a2a";

const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    backgroundColor: HEADER_RED,
  },
  headerText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  body: {
    flex: 1,
  },
  bodyInner: {
    paddingBottom: 24,
  },
  messageSection: {
    padding: 20,
  },
  errorName: {
    color: HEADER_RED,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },
  errorMessage: {
    color: "white",
    fontSize: 17,
    fontWeight: "400",
    lineHeight: 24,
  },
  section: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  sectionTitle: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  sourceCard: {
    backgroundColor: BG_LIGHT,
    borderRadius: 8,
    overflow: "hidden",
  },
  sourceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  sourceRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  sourceLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    fontWeight: "500",
  },
  sourceValue: {
    color: "white",
    fontSize: 14,
    fontFamily: mono,
    fontWeight: "600",
  },
  componentList: {
    backgroundColor: BG_LIGHT,
    borderRadius: 8,
    overflow: "hidden",
  },
  componentRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  componentText: {
    fontSize: 15,
    fontFamily: mono,
  },
  componentBracket: {
    color: "rgba(255,255,255,0.3)",
  },
  componentName: {
    color: "white",
    fontWeight: "500",
  },
  componentSource: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontFamily: mono,
    marginTop: 3,
  },
  traceToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    marginBottom: 8,
  },
  chevron: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 18,
    fontWeight: "300",
  },
  traceScroll: {
    maxHeight: 220,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: 8,
    padding: 14,
  },
  traceText: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 12,
    fontFamily: mono,
    lineHeight: 18,
  },
  footer: {
    backgroundColor: BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    padding: 16,
    paddingBottom: Platform.OS === "web" ? 16 : 36,
  },
  footerButton: {
    backgroundColor: BG_LIGHT,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  footerButtonPressed: {
    backgroundColor: "#3a3a3a",
  },
  footerButtonText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "600",
  },
  footerButtonTextPressed: {
    color: "white",
  },
});
