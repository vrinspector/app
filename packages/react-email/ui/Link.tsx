import { Link as EmailLink } from "@react-email/components"

type LinkProps = React.PropsWithChildren & { href: string }

export const Link = ({ children, href }: LinkProps) => (
  <EmailLink href={href} style={linkStyle}>
    {children}
  </EmailLink>
)

const linkStyle = {
  color: "#2e3d2e",
  textDecoration: "underline",
  wordBreak: "break-all" as const,
}
