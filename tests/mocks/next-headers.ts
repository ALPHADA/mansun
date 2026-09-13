/** vitest용 next/headers 대체: 요청 컨텍스트 없이 쿠키/헤더를 메모리로 처리 */
const jar = new Map<string, string>();
export async function cookies() {
  return {
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => { jar.set(k, v); },
    delete: (k: string) => { jar.delete(k); },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
  };
}
export async function headers() { return new Headers({ host: "localhost:3100" }); }
export const __cookieJar = jar;
