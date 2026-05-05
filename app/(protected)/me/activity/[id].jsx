// Reuse the polished activity detail screen from History.
// `/me/activity/[id]` passes a Firestore source param so Garmin/Me activities
// render in the same clean activity UI without calling Garmin directly.
import HistoryActivityDetailPage from "../../history/[id]";

export default function MeActivityDetailPage() {
  return <HistoryActivityDetailPage />;
}
