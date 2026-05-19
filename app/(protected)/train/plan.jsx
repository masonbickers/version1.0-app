// app/(protected)/train/plan.jsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

function readParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function buildRedirectParams(params = {}) {
  const planId = readParam(params.planId);
  const id = readParam(params.id);
  const source = readParam(params.source);
  const from = readParam(params.from);

  return {
    ...(planId || id ? { planId: planId || id } : {}),
    ...(id ? { id } : {}),
    ...(source ? { source } : {}),
    ...(from ? { from } : {}),
  };
}

export default function TrainPlanRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    router.replace({
      pathname: "/train/view-plan",
      params: buildRedirectParams(params),
    });
  }, [params, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
