export const sortGenerator = (sortParam: string) => {
  let sort: string | undefined

  switch (sortParam) {
    case 'price-asc':
      sort = 'retailPrice'
      break
    case 'price-desc':
      sort = '-retailPrice'
      break
    default:
      sort = undefined
  }
  return sort
}

export const pageGenerator = (pageParam: string) => {
  return pageParam ? Number(pageParam) : 1
}