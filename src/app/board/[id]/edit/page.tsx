import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { boardPost } from "@/server/board";
import { BoardEditor } from "@/components/board-editor";
import { Back, Heading, LoginGate } from "@/components/ui";
export const metadata = { title: "게시글 수정" };
export default async function Edit({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params,
    u = await currentUser();
  if (!u) return <LoginGate next={`/board/${id}/edit`} />;
  const p = await boardPost(id, u);
  if (!p || !p.own) notFound();
  return (
    <div className="narrow">
      <Back href={`/board/${id}`} label="게시글" />
      <Heading title="글 수정" />
      <BoardEditor post={{ id: p.id, title: p.title, body: p.body }} />
    </div>
  );
}
