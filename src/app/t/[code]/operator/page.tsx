import { redirect } from "next/navigation";

export default async function OperatorHome({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/t/${code}/operator/dashboard`);
}
