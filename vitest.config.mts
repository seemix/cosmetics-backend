import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/int/**/*.int.spec.ts'],
    // Окрема тестова БД (replica set) і вимкнені зовнішні сервіси. Секрети лишаються в .env.
    env: {
      DATABASE_URI: 'mongodb://127.0.0.1:27017/cosmetics_test?replicaSet=rs0',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      DEEPL_KEY: 'test-deepl-key',
      RESEND_API_KEY: 're_test_key',
    },
    // Тести ділять одну БД, тому файли йдуть послідовно.
    fileParallelism: false,
    // @payloadcms/ui 3.75 підтягує CSS з react-image-crop (через payload-sidebar-plugin); Node не вміє його імпортувати, тож ганяємо через Vite.
    server: { deps: { inline: [/react-image-crop/, /@payloadcms\/ui/, /payload-sidebar-plugin/] } },
  },
})
