import { Button, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';

export const VerifyEmail = ({ email, url }: { email: string; url: string }) => (
  <BaseLayout>
    <Text>Привіт, {email} 👋</Text>
    <Text>
      Дякуємо за реєстрацію. Натисніть кнопку нижче, щоб підтвердити email.
    </Text>

    <Button
      href={url}
      style={{
        backgroundColor: '#2563eb',
        color: '#ffffff',
        padding: '12px 20px',
        borderRadius: '6px',
        textDecoration: 'none',
      }}
    >
      Підтвердити email
    </Button>

    <Text style={{ fontSize: '12px', marginTop: '16px' }}>
      Якщо ви не створювали акаунт — просто проігноруйте цей лист.
    </Text>
  </BaseLayout>
);
