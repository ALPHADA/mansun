import bcrypt from "bcryptjs";
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string | null | undefined) =>
  hash ? bcrypt.compare(pw, hash) : Promise.resolve(false);
