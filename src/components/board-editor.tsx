import { ActionForm } from "./actions";
export function BoardEditor({
  post,
}: {
  post?: { id: string; title: string; body: string };
}) {
  return (
    <ActionForm
      endpoint="board/posts"
      redirect="/board/:id"
      submitLabel={post ? "수정 저장" : "글 등록"}
    >
      {post && <input type="hidden" name="id" value={post.id} />}
      <label>
        제목
        <input
          name="title"
          defaultValue={post?.title}
          required
          maxLength={100}
        />
      </label>
      <label>
        내용
        <textarea
          name="body"
          defaultValue={post?.body}
          required
          maxLength={10000}
          rows={12}
        />
      </label>
      <p className="form-note">
        누구나 읽을 수 있습니다. 공개하고 싶지 않은 연락처나 개인정보는 적지
        마세요.
      </p>
    </ActionForm>
  );
}
