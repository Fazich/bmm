import { PublicBookmarkController } from '@/controllers'
import { findManyBookmarksSchema } from '@/controllers/schemas'
import { DEFAULT_PUBLIC_TAG_PAGESIZE, WEBSITE_KEYWORDS } from '@cfg'
import PublicHomeBody from '../../components/PublicHomeBody'

export const generateMetadata: GenerateMetadata<{ slug: string }> = (props) => {
  const tag = decodeURIComponent(props.params.slug)
  return {
    title: tag + '相关的书签',
    keywords: `${tag}相关的网站, ${tag}网站推荐, ` + WEBSITE_KEYWORDS,
  }
}

export default async function Page(props: RSCPageProps) {
  const tagNames = decodeURIComponent(props.params.slug).split('+')
  const params: typeof findManyBookmarksSchema._input = {
    tagNames,
    limit: DEFAULT_PUBLIC_TAG_PAGESIZE,
  }
  const res = await PublicBookmarkController.findMany(findManyBookmarksSchema.parse(params))
  return <PublicHomeBody searchedTotalBookmarks={res.total} bookmarks={res.list} />
}
