import Link from "next/link";
import { Heading } from "@/components/ui";
export const metadata = { title: "이용 안내" };
export default function Guide() {
  return (
    <div className="narrow prose">
      <Heading
        title="이용 안내"
        description="전국 산지의 중매인과 매입회원을 연결합니다."
      />
      <h2>매입회원이라면</h2>
      <ol>
        <li>카카오로 가입하고 관심 지역·어종을 설정하세요.</li>
        <li>물건의 사진, 규격, 가격 단위와 픽업 조건을 확인하세요.</li>
        <li>
          전화·문자로 중매인에게 연락해 최종 가격·잔량·인수 시각을 협의하세요.
        </li>
        <li>원하는 물건이 없다면 매입 요청을 남기세요.</li>
      </ol>
      <h2>중매인이라면</h2>
      <ol>
        <li>소속 위판장과 중매인 번호를 등록하면 운영자가 확인합니다.</li>
        <li>확보한 물건의 사진·가격·수량을 등록하세요.</li>
        <li>
          판매가 끝나면 판매 완료로 바꿔주세요. 등록일 자정에는 자동 마감됩니다.
        </li>
        <li>
          남은 물건은 이전 글을 복사하고 상태를 다시 확인해 올릴 수 있습니다.
        </li>
      </ol>
      <h2>지역 시세를 읽는 방법</h2>
      <p>
        등록 판매가는 중매인이 제시한 금액이며 실제 낙찰가나 최종 거래가와
        다릅니다. 같은 상태·규격·단위끼리 비교해주세요. 풍어의 등록 물량은 전체
        위판량이나 현재 재고가 아닙니다.
      </p>
      <h2>잘못된 정보가 있다면</h2>
      <p>
        로그인 후 각 상세 화면의 ‘잘못된 정보 신고’를 이용해주세요. 운영자가
        신고와 게시물을 확인하고 처리합니다.
      </p>
      <Link className="button" href="/login">
        풍어 시작하기
      </Link>
    </div>
  );
}
