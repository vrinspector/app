import { Text } from "@react-email/components"
import { LinkButton } from "../ui/Button"
import { Callout, Detail } from "../ui/Callout"
import { Heading } from "../ui/Heading"
import { Layout } from "../ui/Layout"
import { Link } from "../ui/Link"

/*
 * Member invite (increment 13.5, first use of the outbound-email service).
 * Sent when a project owner adds someone on the project's Members section,
 * and again when the owner presses "Resend invite". The context is built in
 * `member_invite_email()` in backend/app/core/email.py.
 */

type MemberInviteProps = {
  app_name: string
  inviter: string
  project_name: string
  project_client: string
  role_label: string
  role_description: string
  email: string
  link: string
}

export default function MemberInvite({
  app_name = "{{ app_name }}",
  inviter = "{{ inviter }}",
  project_name = "{{ project_name }}",
  project_client = "{{ project_client }}",
  role_label = "{{ role_label }}",
  role_description = "{{ role_description }}",
  email = "{{ email }}",
  link = "{{ link }}",
}: MemberInviteProps) {
  return (
    <Layout
      title={`You've been added to ${project_name}`}
      preview={`${inviter} added you to ${project_name} on ${app_name}`}
      project_name={app_name}
    >
      <Heading>You've been added to a project</Heading>
      <Text style={bodyTextStyle}>Hi,</Text>
      <Text style={bodyTextStyle}>
        {inviter} added you to the project <strong>{project_name}</strong> on{" "}
        {app_name}, the field inspection app, with the {role_label} role.{" "}
        {role_description}
      </Text>
      <Callout>
        <Detail label="Project" value={project_name} />
        <Detail label="Client" value={project_client} />
        <Detail label="Your role" value={role_label} />
        <Detail label="Sign in with" value={email} />
      </Callout>
      <LinkButton href={link}>Open the project</LinkButton>
      <Text style={supportingTextStyle}>
        Sign in (or create your account) with the email address above — that is
        how {app_name} knows it's you. If the button doesn't work, copy this
        link into your browser: <Link href={link}>{link}</Link>
      </Text>
      <Text style={supportingTextStyle}>
        Not expecting this? You can ignore this email; nothing happens until you
        sign in.
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
