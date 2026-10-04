import { redirect } from "next/navigation";
import { currentUser } from "@/server/auth";
import { ownedListing } from "@/server/mutations";
import { taxonomy } from "@/server/queries";
import { Heading, LoginGate, Back } from "@/components/ui";
import { SpeciesPicker } from "@/components/species-picker";
import { ActionForm, Photos } from "@/components/actions";
export const metadata = { title: "물건 올리기" };
export default async function NewListing({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string; edit?: string }>;
}) {
  const u = await currentUser();
  if (!u) return <LoginGate next="/listings/new" />;
  if (u.role !== "broker")
    return (
      <>
        <Heading
          title="중매인 회원만 물건을 올릴 수 있어요"
          description="매입회원·보관업체 회원은 물건을 등록할 수 없습니다. 역할 변경은 운영자에게 요청해주세요."
        />
        <a className="button" href="/me">
          내 정보로 가기
        </a>
      </>
    );
  if (!u.profile.market || !u.profile.license)
    return (
      <>
        <Heading
          title="소속 위판장과 중매인 번호를 먼저 입력해주세요"
          description="내 정보에 두 항목을 입력하면 바로 물건을 올릴 수 있습니다."
        />
        <a className="button" href="/me/profile">
          내 정보 입력
        </a>
      </>
    );
  const p = await searchParams,
    tax = await taxonomy();
  const previous =
    p.copy || p.edit ? await ownedListing((p.copy || p.edit)!, u) : undefined;
  if ((p.copy || p.edit) && !previous) redirect("/me");
  const d = previous;
  return (
    <div className="narrow">
      <Back href="/me" label="내 정보" />
      <Heading
        title={
          p.edit
            ? "물건 수정하기"
            : p.copy
              ? "다시 올릴 물건을 확인해주세요"
              : "오늘 물건 올리기"
        }
        description="사진과 판매 조건을 알려주세요. 오늘 등록한 물건은 자정에 자동 마감됩니다."
      />
      <ActionForm
        endpoint="listings"
        mode="listing"
        redirect="/listings/:id"
        submitLabel={p.edit ? "수정 내용 저장" : "물건 등록하기"}
      >
        {p.edit && <input type="hidden" name="id" value={p.edit} />}
        <Photos initial={d?.photos} />
        <div className="form-divider">
          <h3>어떤 물건인가요?</h3>
        </div>
        <div className="field-pair">
          <SpeciesPicker
            label="어종"
            name="species"
            options={tax.species}
            selected={d ? [d.species] : []}
          />
          <label>
            상태
            <select name="state" defaultValue={d?.state || "선어"}>
              <option>선어</option>
              <option>활어</option>
              <option>냉동</option>
            </select>
          </label>
        </div>
        <label>
          크기·규격
          <input
            name="grade"
            defaultValue={d?.grade}
            required
            maxLength={80}
            placeholder="예: 대 · 1kg당 3~4미"
          />
        </label>
        <div className="field-pair">
          <label>
            가격 단위
            <select name="unit" defaultValue={d?.unit || "kg"}>
              <option>kg</option>
              <option>상자</option>
              <option>마리</option>
            </select>
          </label>
          <label>
            단위당 실중량 (kg, 선택)
            <input
              type="number"
              name="weightKg"
              min="0.001"
              step="0.001"
              defaultValue={d?.weightKg || ""}
              placeholder="알고 있을 때만 입력"
            />
          </label>
        </div>
        <div className="field-pair">
          <label>
            최소 판매가 (원)
            <input
              type="number"
              name="priceMin"
              min="1"
              required
              defaultValue={d?.priceMin}
            />
          </label>
          <label>
            최대 판매가 (원)
            <input
              type="number"
              name="priceMax"
              min="1"
              required
              defaultValue={d?.priceMax}
            />
          </label>
        </div>
        <p className="form-note">
          고정 가격이면 최소·최대 금액을 같게 입력해주세요. 선택한 단위 1개
          기준입니다.
        </p>
        <div className="field-pair">
          <label>
            대략적인 판매 수량
            <input
              type="number"
              name="quantity"
              step="0.001"
              min="0.001"
              required
              defaultValue={d?.quantity}
            />
          </label>
          <label>
            최소 구매 수량
            <input
              type="number"
              name="minimum"
              step="0.001"
              min="0.001"
              required
              defaultValue={d?.minimum || 1}
            />
          </label>
        </div>
        <div className="form-divider">
          <h3>어디서 받을 수 있나요?</h3>
        </div>
        <div className="field-pair">
          <label>
            지역
            <input
              name="region"
              required
              defaultValue={d?.region || u.profile.region}
              placeholder="충남 태안"
              list="regions"
            />
            <datalist id="regions">
              {tax.regions.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </datalist>
          </label>
          <label>
            위판장·판매 장소
            <input
              name="market"
              required
              defaultValue={d?.market || u.profile.market}
            />
          </label>
        </div>
        <label>
          상세 픽업 위치
          <input
            name="pickup"
            required
            maxLength={160}
            defaultValue={d?.pickup}
            placeholder="정확한 인수 위치 · 로그인 회원에게만 공개"
          />
        </label>
        <label>
          픽업 가능 시간
          <input
            name="pickupHours"
            required
            defaultValue={d?.pickupHours}
            placeholder="예: 오늘 오전 7시~오후 2시"
          />
        </label>
        <label>
          추가 안내
          <textarea
            name="note"
            defaultValue={d?.note}
            maxLength={1500}
            placeholder="선별 상태, 포장, 상차 안내 등을 적어주세요."
          />
        </label>
        <label className="check">
          <input type="checkbox" name="confirmed" required />
          <span>
            현재 확보한 물건이며, 사진·가격·수량·상태를 확인했습니다. 연락
            가능한 업무 번호가 회원에게 공개됩니다.
          </span>
        </label>
      </ActionForm>
    </div>
  );
}
