

import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { useAuth } from "@/providers/auth";

// ensure this ENV is set via EAS secrets or .env
const RC_API_KEY = process.env.EXPO_PUBLIC_RC_API_KEY!;

export default function Paywall() {
  const { user } = useAuth();
  const [monthly, setMonthly] = useState<PurchasesPackage>();
  const [loading, setLoading] = useState(true);

  // initialise once
  useEffect(() => {
    (async () => {
      await Purchases.configure({ apiKey: RC_API_KEY, appUserID: user.id });
      const offerings = await Purchases.getOfferings();
      setMonthly(offerings.current?.monthly);
      setLoading(false);
    })();
  }, []);

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

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  if (!monthly)
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text>No products configured</Text>
      </View>
    );

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", marginBottom: 8 }}>note companion pro</Text>
      <Text style={{ color: "#666", marginBottom: 24 }}>unlimited tokens • priority ocr • gpt‑4 vision</Text>
      <TouchableOpacity onPress={buy} style={{ backgroundColor: "#10b981", paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 }}>
        <Text style={{ color: "#fff", fontWeight: "600" }}>upgrade · {monthly.product.price_string}</Text>
      </TouchableOpacity>
    </View>
  );
}