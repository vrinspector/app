import { Text } from "@react-email/components"
import { LinkButton } from "../ui/Button"
import { Callout, Detail } from "../ui/Callout"
import { Heading } from "../ui/Heading"
import { Layout } from "../ui/Layout"
import { Link } from "../ui/Link"

/*
 * Signing link (increment 14). Sent when someone on the project asks an
 * external signer to sign an ITP or an area's combined pack, and again as a
 * reminder (a reminder carries a fresh link; the old one stops working).
 * The context is built in `sign_request_email()` in backend/app/core/email.py.
 */

type SignRequestProps = {
  app_name: string
  heading: string
  intro: string
  requester: string
  project_name: string
  project_client: string
  role_name: string
  documents: string
  ready_count: string
  expires: string
  email: string
  link: string
}

export default function SignRequest({
  app_name = "{{ app_name }}",
  heading = "{{ heading }}",
  intro = "{{ intro }}",
  requester = "{{ requester }}",
  project_name = "{{ project_name }}",
  project_client = "{{ project_client }}",
  role_name = "{{ role_name }}",
  documents = "{{ documents }}",
  ready_count = "{{ ready_count }}",
  expires = "{{ expires }}",
  email = "{{ email }}",
  link = "{{ link }}",
}: SignRequestProps) {
  return (
    <Layout
      title={heading}
      preview={`${requester} asks you to sign as ${role_name} on ${project_name}`}
      project_name={app_name}
    >
      <Heading>{heading}</Heading>
      <Text style={bodyTextStyle}>Hi,</Text>
      <Text style={bodyTextStyle}>{intro}</Text>
      <Callout>
        <Detail label="Project" value={`${project_name} · ${project_client}`} />
        <Detail label="To sign" value={documents} />
        <Detail label="You sign as" value={role_name} />
        <Detail label="Lines ready for you" value={ready_count} />
        <Detail label="Link works until" value={expires} />
      </Callout>
      <LinkButton href={link}>Review and sign</LinkButton>
      <Text style={supportingTextStyle}>
        No account is needed. The link opens the lines waiting for you; you
        review them, draw your signature and sign once. Your signature is
        stamped with the time, the weather at the site and — if you allow it —
        your location. If the button doesn't work, copy this link into your
        browser: <Link href={link}>{link}</Link>
      </Text>
      <Text style={supportingTextStyle}>
        This link is for {email} only and works once. Don't forward it; ask{" "}
        {requester} for a new one if someone else should sign.
      </Text>
    </Layout>
  )
}

const bodyTextStyle = {
  color: "#2b2b2b",
  fontSize: "15px",
  lineHeight: "26px",
  margin: "0 0 18px",
}

const supportingTextStyle = {
  color: "#6b6b6b",
  fontSize: "14px",
  lineHeight: "23px",
  margin: "0 0 16px",
}
