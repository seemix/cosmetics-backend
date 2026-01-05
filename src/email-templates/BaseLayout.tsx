// emails/BaseLayout.tsx
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
} from '@react-email/components';

export const BaseLayout = ({ children }: { children: React.ReactNode }) => (
  <Html>
    <Head />
    <Body style={body}>
      <Container style={container}>
        <Section>{children}</Section>
        <Hr />
        <Text style={footer}>
          © {new Date().getFullYear()} Next Level Shop
        </Text>
      </Container>
    </Body>
  </Html>
);

const body = {
  backgroundColor: '#f6f9fc',
  fontFamily: 'Arial, sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  padding: '32px',
  borderRadius: '8px',
};

const footer = {
  fontSize: '12px',
  color: '#8898aa',
  marginTop: '24px',
};
