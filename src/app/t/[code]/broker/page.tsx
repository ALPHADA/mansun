import { redirect } from "next/navigation";

export default async function BrokerHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/t/${code}/broker/auctions`);
}
