import { UserProfile } from "@clerk/nextjs";

export default function AccountSettingsPage() {
  return <UserProfile routing="hash" />;
}
