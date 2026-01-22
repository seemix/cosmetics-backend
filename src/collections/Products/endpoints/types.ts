export type ProductsByRelationResult = {
  products: any[]
  pagination: {
    page: number
    limit: number
    totalPages: number
    totalDocs: number
    hasNextPage: boolean
    hasPrevPage: boolean
    nextPage: number | null
    prevPage: number | null
  }
  brand?: unknown
  categories?: unknown[]
}