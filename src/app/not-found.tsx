import { Empty } from "@/components/ui";
export default function NotFound() {
  return (
    <Empty
      title="찾으시는 페이지가 없습니다"
      description="주소가 변경되었거나 더 이상 공개되지 않는 정보입니다."
      href="/"
      label="오늘 물건으로 이동"
    />
  );
}
