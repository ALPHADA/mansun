import { currentUser } from "@/server/auth";
import { boardSettings } from "@/server/board";
import { BoardSettings } from "@/components/board-settings";
import { BoardEditor } from "@/components/board-editor";
import { Back, Heading, LoginGate } from "@/components/ui";
export const metadata = { title: "게시글 작성" };
export default async function NewPost() {
  const u = await currentUser();
  if (!u)
    return <LoginGate next="/board/new" message="로그인하고 글을 작성하세요" />;
  const s = await boardSettings(u);
  return (
    <div className="narrow">
      <Back href="/board" label="자유게시판" />
      <Heading title="글쓰기" />
      {s.nickname ? (
        <BoardEditor />
      ) : (
        <BoardSettings
          nickname={null}
          enabled={s.board_notifications}
          next="/board/new"
        />
      )}
    </div>
  );
}
