import { ResetPasswordForm } from "@/components/admin/AdminAuth";

export const metadata = { title: "Reset admin password - Confluence" };

export default function AdminResetPage() {
  return (
    <div className="w-full max-w-[400px]">
      <ResetPasswordForm />
    </div>
  );
}
