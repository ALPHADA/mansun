import { currentUser } from "@/server/auth";
import { db } from "@/server/db";
import { taxonomy } from "@/server/queries";
import { Heading, Back, LoginGate } from "@/components/ui";
import { SpeciesPicker } from "@/components/species-picker";
import { ActionForm } from "@/components/actions";
import type { Warehouse } from "@/lib/model";
export const metadata = { title: "보관업체 등록" };
export default async function NewStorage() {
  const u = await currentUser();
  if (!u) return <LoginGate next="/storage/new" />;
  if (u.role !== "storage")
    return (
      <Heading
        title="보관업체 회원 전용 기능입니다"
        description="회원 역할 변경은 운영자에게 요청해주세요."
      />
    );
  const [row] = await db()<
    Warehouse[]
  >`SELECT * FROM warehouses WHERE owner_id=${u.id}`;
  const d = row?.data,
    tax = await taxonomy();
  return (
    <div className="narrow">
      <Back href="/storage" label="보관업체" />
      <Heading
        title="우리 보관업체 소개"
        description="보관 조건을 자세히 알려주시면 적합한 거래처가 연락할 수 있습니다."
      />
      <ActionForm
        endpoint="storage"
        mode="storage"
        redirect="/storage"
        submitLabel="업체 소개 저장"
      >
        <label>
          업체명
          <input
            name="name"
            required
            defaultValue={d?.name || u.profile.business}
          />
        </label>
        <div className="field-pair">
          <label>
            지역
            <input
              name="region"
              required
              defaultValue={d?.region || u.profile.region}
            />
          </label>
          <label>
            보관 구분
            <select name="kind" defaultValue={d?.kind || "냉동·냉장"}>
              <option>냉동·냉장</option>
              <option>냉동</option>
              <option>냉장</option>
            </select>
          </label>
        </div>
        <label>
          상세 주소
          <input name="address" required defaultValue={d?.address} />
        </label>
        <SpeciesPicker
          label="취급 어종"
          name="species"
          options={tax.species}
          selected={d ? [d.species].flat() : []}
          multiple
        />
        <label>
          운영 시간
          <input
            name="hours"
            required
            defaultValue={d?.hours || u.profile.hours}
          />
        </label>
        <label>
          보관 조건과 이용 안내
          <textarea
            name="conditions"
            required
            defaultValue={d?.conditions}
            maxLength={1500}
            placeholder="보관 온도, 최소 이용 조건, 입출고·상차 안내 등"
          />
        </label>
      </ActionForm>
    </div>
  );
}
