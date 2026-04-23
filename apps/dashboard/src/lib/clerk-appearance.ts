import type { SignIn } from "@clerk/nextjs";
import type { ComponentProps } from "react";

type ClerkAppearance = NonNullable<ComponentProps<typeof SignIn>["appearance"]>;

export const clerkAppearance: ClerkAppearance = {
  variables: {
    colorPrimary: "hsl(var(--primary))",
    colorBackground: "hsl(var(--background))",
    colorText: "hsl(var(--foreground))",
    colorTextSecondary: "hsl(var(--muted-foreground))",
    colorInputBackground: "hsl(var(--background))",
    colorInputText: "hsl(var(--foreground))",
    colorDanger: "hsl(var(--destructive))",
    borderRadius: "var(--radius)",
    fontFamily: "inherit",
  },
  elements: {
    card: "shadow-sm border border-border bg-card",
    headerTitle: "text-foreground",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButton: "border-border",
    formFieldInput: "border-input",
    footerActionLink: "text-primary hover:opacity-90",
  },
};
