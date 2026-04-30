import logoUrl from "./remarks-logo.svg";

interface Props {
  className?: string;
  size?: number;
}

export function RemarksLogo({ className, size = 24 }: Props) {
  return (
    <img src={logoUrl} alt="" width={size} height={size} className={className} aria-hidden="true" />
  );
}
