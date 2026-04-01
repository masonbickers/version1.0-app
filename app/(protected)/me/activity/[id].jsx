// Reuse the fully implemented activity detail screen from History.
// This keeps `/me/activity/[id]` and `/history/[id]` consistent.
import HistoryActivityDetailPage from "../../history/[id]";

export default function MeActivityDetailPage() {
  return <HistoryActivityDetailPage />;
}
