// emails/ResetPassword.tsx
import { Button, Text } from '@react-email/components';
import { BaseLayout } from './BaseLayout';

export const ResetPassword = ({ url }: { url: string }) => (
  <BaseLayout>
    <Text>Ви запросили зміну пароля</Text>

    <Text>
      Натисніть кнопку нижче, щоб встановити новий пароль.
    </Text>

    <Button
      href={url}
      style={{
        backgroundColor: '#dc2626',
        color: '#ffffff',
        padding: '12px 20px',
        borderRadius: '6px',
      }}
    >
      Скинути пароль
    </Button>

    <Text style={{ fontSize: '12px', marginTop: '16px' }}>
      Посилання дійсне протягом 1 години.
    </Text>
  </BaseLayout>
);
