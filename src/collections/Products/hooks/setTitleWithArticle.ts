import { FieldHook } from 'payload'

export const setTitleWithArticle: FieldHook = ({ data, originalDoc }) => {
  const title = data?.title || originalDoc?.title || ''
  const article = data?.article || originalDoc?.article || ''
  return `${title} [${article}]`.trim()
}
