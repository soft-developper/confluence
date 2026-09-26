import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = { title: "Profile - Confluence" };

export default function ProfilePage() {
  return (
    <PageShell>
      <ProfileView />
    </PageShell>
  );
}
