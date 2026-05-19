// app/(protected)/train/run-plan-preview.jsx
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
  const draftId = readParam(params.draftId);
  const previewId = readParam(params.previewId);

  return {
    ...(planId || id ? { planId: planId || id } : {}),
    ...(id ? { id } : {}),
    ...(source ? { source } : {}),
    ...(from ? { from } : {}),
    ...(draftId ? { draftId } : {}),
    ...(previewId ? { previewId } : {}),
  };
}

export default function RunPlanPreviewRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const planId = readParam(params.planId);
  const id = readParam(params.id);

  useEffect(() => {
    router.replace({
      pathname: planId || id ? "/train/view-plan" : "/train/create/create-run",
      params: buildRedirectParams(params),
    });
  }, [id, params, planId, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
