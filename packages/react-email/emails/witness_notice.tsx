import { Text } from "@react-email/components"
import { Callout, Detail } from "../ui/Callout"
import { Heading } from "../ui/Heading"
import { Layout } from "../ui/Layout"

/*
 * Witness / hold point notice (increment 14). Sent from an ITP line when the
 * work is coming up to a witness or hold point, so the notified party can
 * attend. The context is built in `witness_notice_email()` in
 * backend/app/core/email.py.
 */

type WitnessNoticeProps = {
  app_name: string
  heading: string
  sender: string
  project_name: string
  project_client: string
  document: string
  point_type: string
  requirement: string
  role_name: string
  planned_for: string
  message: string
}

export default function WitnessNotice({
  app_name = "{{ app_name }}",
  heading = "{{ heading }}",
  sender = "{{ sender }}",
  project_name = "{{ project_name }}",
  project_client = "{{ project_client }}",
  document = "{{ document }}",
  point_type = "{{ point_type }}",
  requirement = "{{ requirement }}",
  role_name = "{{ role_name }}",
  planned_for = "{{ planned_for }}",
  message = "{{ message }}",
}: WitnessNoticeProps) {
  return (
    <Layout
      title={heading}
      preview={`${point_type}: ${requirement} — ${project_name}`}
      project_name={app_name}
    >
      <Heading>{heading}</Heading>
      <Text style={bodyTextStyle}>Hi,</Text>
      <Text style={bodyTextStyle}>
        {sender} is giving notice that the work is coming up to a{" "}
        {point_type.toLowerCase()} on {project_name}. You are listed as{" "}
        {role_name} for this point.
      </Text>
      <Callout>
        <Detail label="Project" value={`${project_name} · ${project_client}`} />
        <Detail label="Document" value={document} />
        <Detail label={point_type} value={requirement} />
        <Detail label="Expected" value={planned_for} />
        <Detail label="Message" value={message} />
      </Callout>
      <Text style={supportingTextStyle}>
        Reply to {sender} to confirm whether you will attend. When the line is
        ready to sign you will receive a separate signing link.
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
