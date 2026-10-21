import { Clients } from "../../components/clients";
import { readSession } from "../../lib/session";

export default async function ClientsPage() {
  return <Clients session={await readSession()} />;
}
