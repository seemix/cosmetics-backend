import type { User } from '@/payload-types'
import { checkRole } from '@/access/utilities'

/** Повний `User` у хуках і access або клієнтський користувач у `admin.hidden`: читаємо лише `roles`. */
type AnyUser = object | null | undefined

export const isAdmin = (user: AnyUser): boolean => checkRole(['admin'], user as User)

/** Менеджер без ролі admin: до нього застосовуються обмеження розд. 11. */
export const isManager = (user: AnyUser): boolean => checkRole(['manager'], user as User) && !isAdmin(user)

/** `admin.hidden` облікових колекцій і глобалів: у сайдбарі їх бачить лише admin. */
export const hiddenUnlessAdmin = ({ user }: { user: AnyUser }): boolean => !isAdmin(user)
