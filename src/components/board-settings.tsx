import { ActionForm } from "./actions";
export function BoardSettings({
  nickname,
  enabled,
  next,
}: {
  nickname: string | null;
  enabled: boolean;
  next?: string;
}) {
  return (
    <section className="board-settings">
      <h2>게시판 별명·알림</h2>
      <ActionForm endpoint="board/settings" redirect={next}>
        <label>
          별명
          <input
            name="nickname"
            defaultValue={nickname || ""}
            minLength={2}
            maxLength={20}
            required
          />
        </label>
        <p className="form-note">
          게시판에는 이 별명만 표시됩니다. 2~20자, 다른 회원과 중복할 수
          없습니다.
        </p>
        <label>
          내 글의 댓글 알림
          <select name="notifications" defaultValue={String(enabled)}>
            <option value="true">받기</option>
            <option value="false">받지 않기</option>
          </select>
        </label>
      </ActionForm>
    </section>
  );
}
