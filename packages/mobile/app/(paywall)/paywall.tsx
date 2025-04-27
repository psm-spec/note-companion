import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { useAuth } from "@/providers/auth";

// ensure this ENV is set via EAS secrets or .env
// Check for API Key existence
const RC_API_KEY = process.env.EXPO_PUBLIC_RC_API_KEY;

export default function Paywall() {
  const { user } = useAuth() as any; // Using any assertion consistent with _layout.tsx
  const [monthly, setMonthly] = useState<PurchasesPackage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // State to hold error messages

  // initialise and fetch offerings
  useEffect(() => {
    const initializeAndFetch = async () => {
      setError(null); // Reset error on retry/mount
      // Ensure API Key exists before configuring
      if (!RC_API_KEY) {
        console.error("[Paywall] EXPO_PUBLIC_RC_API_KEY is missing!");
        setError("Subscription service is unavailable.");
        setLoading(false);
        return;
      }
      
      try {
        console.log("[Paywall] Configuring Purchases...");
        // Use try/catch for configure as well
        await Purchases.configure({ apiKey: RC_API_KEY, appUserID: user?.id });
        console.log("[Paywall] Configure SUCCESS. Fetching offerings...");
        
        const offerings = await Purchases.getOfferings();
        console.log("[Paywall] Offerings fetched:", offerings.current);
        if (offerings.current && offerings.current.monthly) {
          setMonthly(offerings.current.monthly);
        } else {
          console.warn("[Paywall] No 'current' or 'monthly' offering found.");
          setError("Subscription options are currently unavailable.");
        }
      } catch (e: any) {
        console.error("[Paywall] Failed to configure Purchases or fetch offerings:", e);
        if (e.code === 'CredentialsError') { // Example specific error check
            setError("Subscription service configuration error.");
        } else if (e.message?.includes(" fetching offerings")) { // Check based on previous error message
            setError("Could not load subscription products from the store. Please check your connection or try again later.");
        } else {
            setError("Could not load subscription options. Please try again later.");
        }
      } finally {
        setLoading(false);
      }
    };
    
    initializeAndFetch();
  }, [user?.id]); // Re-run if user ID changes

  const buy = async () => {
    if (!monthly) return;
    try {
      const { customerInfo } = await Purchases.purchasePackage(monthly);
      if (customerInfo.activeSubscriptions.length) {
        alert("🎉 upgraded!");
      }
    } catch (e: any) {
      if (!e.userCancelled) alert(e.message);
    }
  };

  // --- Render Logic --- 

  // Loading state
  if (loading) {
     return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>Loading Subscription...</Text>
      </View>
    );
  }

  // Error state
  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>Error</Text>
        <Text style={styles.statusText}>{error}</Text>
        {/* Optionally add a retry button here */}
      </View>
    );
  }
  
  // No monthly package found (but no specific error occurred)
  // This path might be hit if Offerings structure is valid but has no 'monthly' package
  if (!monthly) { 
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>Unavailable</Text>
        <Text style={styles.statusText}>No subscription plans are currently configured.</Text>
      </View>
    );
  }

  // Success state: Render the paywall content
  return (
    <View style={styles.paywallContainer}>
      <Text style={styles.titleText}>note companion pro</Text>
      <Text style={styles.subtitleText}>unlimited tokens • priority ocr • gpt‑4 vision</Text>
      <TouchableOpacity onPress={buy} style={styles.buyButton}>
        <Text style={styles.buyButtonText}>upgrade · {monthly.product.price_string}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Add some basic styling
const styles = StyleSheet.create({
  centeredContainer: {
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center",
    padding: 20,
  },
  paywallContainer: {
    flex: 1, 
    justifyContent: "center", 
    alignItems: "center", 
    padding: 24,
    backgroundColor: 'white', // Example background
  },
  statusText: {
    marginTop: 10,
    color: "#666",
    textAlign: 'center',
  },
  errorText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#E53E3E', // Red color for errors
    marginBottom: 5,
  },
  titleText: {
    fontSize: 24, 
    fontWeight: "600", 
    marginBottom: 8,
  },
  subtitleText: {
    color: "#666", 
    marginBottom: 24,
    textAlign: 'center',
  },
  buyButton: {
    backgroundColor: "#10b981", 
    paddingHorizontal: 32, 
    paddingVertical: 12, 
    borderRadius: 12,
  },
  buyButtonText: {
    color: "#fff", 
    fontWeight: "600",
  },
});