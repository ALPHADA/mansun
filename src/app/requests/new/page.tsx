import { currentUser } from "@/server/auth";
import { taxonomy } from "@/server/queries";
import { Heading, Back, LoginGate } from "@/components/ui";
import { ActionForm } from "@/components/actions";
import { kstDay } from "@/lib/model";
export const metadata = { title: "매입 요청하기" };
export default async function NewRequest() {
  const u = await currentUser();
  if (!u) return <LoginGate next="/requests/new" />;
  if (u.role !== "buyer")
    return (
      <Heading
        title="매입회원 전용 기능입니다"
        description="매입 요청은 매입회원이 작성합니다. 역할 변경은 운영자에게 요청해주세요."
      />
    );
  const tax = await taxonomy();
  return (
    <div className="narrow">
      <Back href="/requests" label="매입 요청" />
      <Heading
        title="어떤 물건을 찾고 있나요?"
        description="중매인이 조건을 확인하고 전화·문자로 연락드립니다."
      />
      <ActionForm
        endpoint="requests"
        mode="request"
        redirect="/requests"
        submitLabel="매입 요청 올리기"
      >
        <div className="field-pair">
          <label>
            어종
            <input name="species" required list="species" />
            <datalist id="species">
              {tax.species.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </datalist>
          </label>
          <label>
            희망 지역
            <input
              name="region"
              required
              defaultValue={u.profile.region}
              placeholder="예: 충남 태안"
            />
          </label>
        </div>
        <label>
          희망 크기·규격
          <input
            name="grade"
            required
            placeholder="예: 활꽃게 · 대 · 1kg당 3~4미"
          />
        </label>
        <div className="field-pair">
          <label>
            필요 수량
            <input
              type="number"
              name="quantity"
              required
              min="0.001"
              step="0.001"
            />
          </label>
          <label>
            단위
            <select name="unit">
              <option>kg</option>
              <option>상자</option>
              <option>마리</option>
            </select>
          </label>
        </div>
        <label>
          총 구매 예산 (원)
          <input type="number" name="budget" required min="1" />
        </label>
        <div className="field-pair">
          <label>
            요청 마감일
            <input
              type="date"
              name="deadline"
              required
              min={kstDay()}
              defaultValue={kstDay()}
            />
          </label>
          <label>
            희망 수령일
            <input type="date" name="receiveDate" required min={kstDay()} />
          </label>
        </div>
        <label>
          추가 조건
          <textarea
            name="note"
            maxLength={1500}
            placeholder="픽업 가능 시간, 선별·포장 조건 등을 알려주세요."
          />
        </label>
        <div className="notice">
          상호와 매입 조건이 공개되며, 인증된 업무 연락처는 로그인한 회원에게만
          제공됩니다.
        </div>
      </ActionForm>
    </div>
  );
}
