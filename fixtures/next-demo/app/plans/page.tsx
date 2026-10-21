import { Plans } from "../../components/plans";
import { readSession } from "../../lib/session";

export default async function PlansPage() {
  return <Plans session={await readSession()} />;
}
