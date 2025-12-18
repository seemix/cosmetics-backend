import type { GlobalConfig } from 'payload'

export const Settings: GlobalConfig = {
  slug: 'settings',
  label: 'Store Settings',
  access: {
    read: () => true, // всі можуть читати налаштування
  },
  fields: [
    {
      name: 'currency',
      label: 'Currency',
      type: 'select',
      required: true,
      defaultValue: 'USD',
      options: [
        { label: 'US Dollar (USD)', value: 'USD' },
        { label: 'Euro (EUR)', value: 'EUR' },
        { label: 'Polish Złoty (PLN)', value: 'PLN' },
        { label: 'Ukrainian Hryvnia (UAH)', value: 'UAH' },
        { label: 'British Pound (GBP)', value: 'GBP' },
      ],
    },
  ],
}