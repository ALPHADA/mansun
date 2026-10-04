"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h2>잠시 연결이 원활하지 않습니다</h2>
      <p>입력한 내용을 확인하고 다시 시도해주세요.</p>
      <button className="button" onClick={reset}>
        다시 시도
      </button>
    </div>
  );
}
