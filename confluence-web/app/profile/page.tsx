import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";
import { ProfileView } from "@/components/profile/ProfileView";

export const metadata: Metadata = { title: "Profile - Confluence" };

export default function ProfilePage() {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pt-10 pb-16">
          <ProfileView />
        </main>
      </div>
    </Providers>
  );
}
