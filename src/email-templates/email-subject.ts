const localization = {
  verifyEmail: {
    ru: 'Подтверждение адреса электронной почты',
    ro: 'Confirmă adresa de email',
  },
  forgotPassword: {
    ru: 'Сброс пароля',
    ro: 'Resetare parolă',
  },
}

export const emailSubject = (type: 'verifyEmail' | 'forgotPassword', locale: 'ru' | 'ro') => {
  if (!type || !locale) return ''
  return localization[type][locale]
}