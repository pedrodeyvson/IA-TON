import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  return <p>TON-CRM-IA — API ativa</p>;
}
