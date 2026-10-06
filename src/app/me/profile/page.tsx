import { boardSettings } from "@/server/board";
import { BoardSettings } from "@/components/board-settings";
import { currentUser } from "@/server/auth";
import { taxonomy } from "@/server/queries";
import { Back, Heading, LoginGate } from "@/components/ui";
import { ActionForm } from "@/components/actions";
import { SpeciesPicker } from "@/components/species-picker";
import { roleNames } from "@/lib/model";
export const metadata = { title: "내 정보 수정" };
export default async function Profile() {
  const u = await currentUser();
  if (!u) return <LoginGate next="/me/profile" />;
  const board = await boardSettings(u);
  const p = u.profile,
    tax = await taxonomy();
  return (
    <div className="narrow">
      <Back href="/me" label="내 정보" />
      <Heading
        title="내 정보와 관심 조건"
        description={`${roleNames[u.role]} · 역할 변경은 운영자에게 요청해주세요.`}
      />
      <BoardSettings
        nickname={board.nickname}
        enabled={board.board_notifications}
      />
      <ActionForm endpoint="profile" mode="profile">
        <div className="field-pair">
          <label>
            이름
            <input name="name" required defaultValue={p.name} />
          </label>
          <label>
            상호
            <input name="business" required defaultValue={p.business} />
          </label>
        </div>
        <div className="field-pair">
          <label>
            업종
            <input name="industry" required defaultValue={p.industry} />
          </label>
          <label>
            활동 지역
            <input name="region" required defaultValue={p.region} />
          </label>
        </div>
        <label>
          {u.phone ? "문자 인증된 업무 연락처" : "업무 연락처 (직접 입력)"}
          <input
            name="contact"
            readOnly={!!u.phone}
            defaultValue={u.phone || u.profile.contact}
          />
        </label>
        <p className="form-note">
          로그인한 회원에게 공개됩니다. 번호 변경은 운영자에게 문의해주세요.
        </p>
        <label>
          응대 시간
          <input name="hours" required defaultValue={p.hours} />
        </label>
        {u.role === "broker" ? (
          <>
            <div className="field-pair">
              <label>
                소속 위판장
                <input name="market" required defaultValue={p.market} />
              </label>
              <label>
                중매인 번호
                <input name="license" required defaultValue={p.license} />
              </label>
            </div>
            <SpeciesPicker
              label="주요 취급 어종"
              name="specialties"
              options={tax.species}
              selected={p.specialties}
              multiple
            />
            <label className="check">
              <input
                name="procurement"
                type="checkbox"
                defaultChecked={p.procurement}
              />
              경매 매입 대행이 가능합니다
            </label>
          </>
        ) : (
          <>
            <input type="hidden" name="market" value="" />
            <input type="hidden" name="license" value="" />
          </>
        )}
        <label>
          소개
          <textarea name="bio" maxLength={1500} defaultValue={p.bio} />
        </label>
        <div className="form-divider">
          <h3>내가 관심 있는 지역과 어종</h3>
          <p>선택하지 않으면 전국·전체 어종을 봅니다.</p>
        </div>
        <fieldset>
          <legend>관심 지역</legend>
          <div className="check-grid">
            {tax.regions.map((r) => (
              <label className="check" key={r}>
                <input
                  type="checkbox"
                  name="regions"
                  value={r}
                  defaultChecked={p.interests.regions.includes(r)}
                />
                {r}
              </label>
            ))}
          </div>
        </fieldset>
        <SpeciesPicker
          label="관심 어종"
          name="species"
          options={tax.species}
          selected={p.interests.species}
          multiple
        />
        <div className="form-divider">
          <h3>웹 알림함</h3>
        </div>
        <label className="check">
          <input
            name="notifications"
            type="checkbox"
            defaultChecked={p.notifications}
          />
          관심 물건·매입 요청 하루 요약 받기
        </label>
        <label>
          요약 시간 (한국시간)
          <select name="digestHour" defaultValue={p.digestHour}>
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {i}시
              </option>
            ))}
          </select>
        </label>
        <p className="form-note">
          알림은 풍어 안에서만 확인합니다. 카카오·문자 상품 알림은 보내지
          않습니다.
        </p>
      </ActionForm>
    </div>
  );
}
