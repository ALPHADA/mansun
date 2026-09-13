import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: ["docs/**", ".next/**", "drizzle/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
  { rules: { "@next/next/no-img-element": "off" } },
  // 서버 컴포넌트(page/layout)는 요청당 1회 렌더 — Date.now() 등은 안전
  { files: ["src/app/**/page.tsx", "src/app/**/layout.tsx"], rules: { "react-hooks/purity": "off" } },
];
export default config;