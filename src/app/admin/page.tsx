import { notFound } from "next/navigation";
import { currentUser } from "@/server/auth";
import { adminData, taxonomy } from "@/server/queries";
import { Heading } from "@/components/ui";
import { Action, ActionForm } from "@/components/actions";
import { roleNames, type Role, type Profile } from "@/lib/model";
export const metadata = { title: "운영 관리" };
export default async function Admin() {
  const u = await currentUser();
  if (!u?.admin) notFound();
  const d = await adminData(),
    tax = await taxonomy();
  return (
    <>
      <Heading
        eyebrow="PUNGEO OPERATIONS"
        title="운영 관리"
        description="회원 확인과 게시물 관리 내역은 처리자와 함께 기록됩니다."
      />
      <div className="notice">
        문의 버튼 사용은 거래 성사 수가 아닙니다. 시연 상품은 등록 성과 집계에서
        제외합니다.
      </div>
      <section className="admin-section">
        <h2>최근 이용 현황</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                <th>방문 회원</th>
                <th>실제 상품 등록</th>
                <th>연락 버튼 사용</th>
              </tr>
            </thead>
            <tbody>
              {d.activity.map((a) => (
                <tr key={String(a.day)}>
                  <td>{String(a.day).slice(0, 10)}</td>
                  <td>{a.visitors}</td>
                  <td>{a.listings}</td>
                  <td>{a.contacts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-section">
        <h2>회원 관리</h2>
        <div className="admin-members">
          {d.members.map((m) => {
            const p = m.profile as Profile;
            return (
              <article key={String(m.id)}>
                <div>
                  <h3>
                    {p.business} <small>{p.name}</small>
                  </h3>
                  <p>
                    {roleNames[m.role as Role]} · {p.region} ·{" "}
                    {m.phone
                      ? `${m.phone} (문자 인증)`
                      : `${p.contact} (직접 입력)`}
                  </p>
                  {m.role === "broker" && (
                    <p>
                      소속: {p.market} · 번호: {p.license}
                    </p>
                  )}
                  <span className="state">
                    {m.suspended ? "이용 정지" : "이용 중"}
                  </span>
                </div>
                <div className="row wrap">
                  {!m.admin && (
                    <Action
                      endpoint="admin/member"
                      payload={{ id: m.id, suspended: !m.suspended }}
                      confirmMessage="회원 이용 상태를 변경할까요?"
                    >
                      {m.suspended ? "정지 해제" : "이용 정지"}
                    </Action>
                  )}
                  <details>
                    <summary>역할 변경</summary>
                    {Object.entries(roleNames)
                      .filter(([r]) => r !== m.role)
                      .map(([r, label]) => (
                        <Action
                          key={r}
                          endpoint="admin/member"
                          payload={{ id: m.id, role: r }}
                          confirmMessage={`${label}으로 역할을 변경할까요?`}
                        >
                          {label}
                        </Action>
                      ))}
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="admin-section">
        <h2>신고 접수</h2>
        {!d.reports.length && <p className="muted">접수된 신고가 없습니다.</p>}
        {d.reports.map((r) => (
          <article className="admin-report" key={String(r.id)}>
            <h3>
              {r.kind} · {r.status === "open" ? "미처리" : "처리 완료"}
            </h3>
            <p>{r.reason}</p>
            <small>
              {r.reporter} · 대상 {r.target_id}
            </small>
            {r.status === "open" ? (
              <ActionForm endpoint="admin/report" submitLabel="처리 완료 기록">
                <input type="hidden" name="id" value={String(r.id)} />
                <label>
                  조치 내용
                  <input name="resolution" required />
                </label>
              </ActionForm>
            ) : (
              <p>
                {r.resolution} · 처리자 {r.handled_by}
              </p>
            )}
          </article>
        ))}
      </section>
      <section className="admin-section">
        <h2>게시물 노출 관리</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>종류</th>
                <th>제목</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {d.content.map((c) => (
                <tr key={String(c.id)}>
                  <td>{c.kind}</td>
                  <td>
                    {c.title}
                    <small>{String(c.id)}</small>
                  </td>
                  <td>{c.hidden ? "숨김" : "노출"}</td>
                  <td>
                    <Action
                      endpoint="admin/content"
                      payload={{ id: c.id, kind: c.kind, hidden: !c.hidden }}
                      confirmMessage="게시물 노출 상태를 변경할까요?"
                    >
                      {c.hidden ? "다시 노출" : "숨기기"}
                    </Action>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="admin-section">
        <h2>지역·어종 관리</h2>
        <ActionForm endpoint="admin/taxonomy" submitLabel="추가">
          <div className="field-pair">
            <label>
              종류
              <select name="kind">
                <option value="region">지역</option>
                <option value="species">어종</option>
              </select>
            </label>
            <label>
              이름
              <input name="name" required maxLength={60} />
            </label>
          </div>
        </ActionForm>
        <details>
          <summary>현재 목록</summary>
          <p>{tax.regions.join(" · ")}</p>
          <p className="muted">
            어종은 회원도 직접 추가할 수 있습니다. 잘못된 항목은 숨기면 더
            이상 고를 수 없습니다.
          </p>
          <div className="row wrap">
            {tax.species.map((s) => (
              <Action
                key={s}
                endpoint="admin/taxonomy"
                payload={{ kind: "species", name: s, active: false }}
                confirmMessage={`'${s}' 어종을 목록에서 숨길까요?`}
              >
                {s} 숨김
              </Action>
            ))}
          </div>
          {d.hiddenSpecies.length > 0 && (
            <>
              <p className="muted">숨긴 어종</p>
              <div className="row wrap">
                {d.hiddenSpecies.map((s) => (
                  <Action
                    key={s}
                    endpoint="admin/taxonomy"
                    payload={{ kind: "species", name: s, active: true }}
                  >
                    {s} 다시 표시
                  </Action>
                ))}
              </div>
            </>
          )}
        </details>
      </section>
      <section className="admin-section">
        <h2>검증된 공식 경락 정보 등록</h2>
        <p className="muted">
          원문 기준일·규격·제공 범위와 재사용 가능 여부를 확인한 자료만
          등록하세요. 회원 판매가와 별도로 표시됩니다.
        </p>
        <ActionForm
          endpoint="admin/official"
          mode="official"
          submitLabel="공식 참고 정보 등록"
        >
          <div className="field-pair">
            <label>
              출처 기관
              <input name="sourceName" required />
            </label>
            <label>
              원문 HTTPS 주소
              <input name="sourceUrl" type="url" required />
            </label>
          </div>
          <div className="field-pair">
            <label>
              기준일
              <input name="day" type="date" required />
            </label>
            <label>
              지역
              <input name="region" required />
            </label>
          </div>
          <div className="field-pair">
            <label>
              어종
              <input name="species" required />
            </label>
            <label>
              상태
              <input name="state" required placeholder="선어·활어·냉동" />
            </label>
          </div>
          <div className="field-pair">
            <label>
              규격
              <input name="grade" required />
            </label>
            <label>
              거래 단위
              <input name="unit" required />
            </label>
          </div>
          <div className="field-pair">
            <label>
              최소 가격
              <input name="priceMin" type="number" min="1" required />
            </label>
            <label>
              최대 가격
              <input name="priceMax" type="number" min="1" required />
            </label>
          </div>
          <label className="check">
            <input name="verified" type="checkbox" required />
            원문·기준일·제공 범위·이용 조건을 확인했습니다.
          </label>
        </ActionForm>
      </section>
      <section className="admin-section">
        <h2>운영 변경 이력</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>처리 시각</th>
                <th>운영자</th>
                <th>작업</th>
                <th>대상</th>
              </tr>
            </thead>
            <tbody>
              {d.audit.map((a) => (
                <tr key={String(a.id)}>
                  <td>
                    {new Date(a.created_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}
                  </td>
                  <td>{a.actor}</td>
                  <td>{a.action}</td>
                  <td>{a.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
