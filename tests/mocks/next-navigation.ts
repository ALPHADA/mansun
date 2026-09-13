export class RedirectError extends Error { constructor(public url: string) { super(`NEXT_REDIRECT ${url}`); this.name = "RedirectError"; } digest = "NEXT_REDIRECT"; }
export class NotFoundError extends Error { digest = "NEXT_HTTP_ERROR_FALLBACK;404"; constructor() { super("NEXT_NOT_FOUND"); this.name = "NotFoundError"; } }
export function redirect(url: string): never { throw new RedirectError(url); }
export function notFound(): never { throw new NotFoundError(); }
