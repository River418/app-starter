export interface Identity {
  userId: string;
  email: string;
  role: "admin" | "member";
}
