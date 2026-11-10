import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components"

type LayoutProps = React.PropsWithChildren & {
  title: string
  project_name: string
  preview?: string
}

export const Layout = ({
  project_name,
  title,
  preview,
  children,
}: LayoutProps) => {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      {preview ? <Preview>{preview}</Preview> : null}
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Row>
            <Column style={contentStyle}>
              <Section style={bandStyle}>
                <Text style={brandStyle}>{project_name}</Text>
                <Hr style={brandRuleStyle} />
              </Section>
              <Section style={innerStyle}>{children}</Section>
              <Section style={innerStyle}>
                <Hr style={footerRuleStyle} />
                <Text style={footerStyle}>
                  {project_name} · Field Inspect LLC
                </Text>
              </Section>
            </Column>
          </Row>
        </Container>
      </Body>
    </Html>
  )
}

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'

// VR Inspector v2.51 palette (frontend/src/index.css): forest green band,
// gold rule and calls to action, copper labels, charcoal text on off-white.
const bodyStyle = {
  backgroundColor: "#f7f5f0",
  color: "#2b2b2b",
  fontFamily,
  margin: "0",
  padding: "32px 12px",
}

const containerStyle = {
  backgroundColor: "#ffffff",
  border: "1px solid #e4dfd3",
  borderRadius: "8px",
  overflow: "hidden" as const,
  boxSizing: "border-box" as const,
  margin: "0 auto",
  maxWidth: "560px",
  width: "100%",
}

const contentStyle = {
  padding: "0 0 28px",
}

const bandStyle = {
  backgroundColor: "#2e3d2e",
  padding: "22px 36px 18px",
}

const innerStyle = {
  padding: "0 36px",
}

const brandRuleStyle = {
  border: "0",
  borderTop: "3px solid #b8960c",
  margin: "10px 0 0",
  width: "40px",
}

const brandStyle = {
  color: "#f7f5f0",
  fontSize: "14px",
  fontWeight: "700",
  letterSpacing: "1.5px",
  lineHeight: "20px",
  margin: "0",
  textTransform: "uppercase" as const,
}

const footerRuleStyle = {
  border: "0",
  borderTop: "1px solid #e4dfd3",
  margin: "28px 0 16px",
  width: "100%",
}

const footerStyle = {
  color: "#6b6b6b",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "0",
}
