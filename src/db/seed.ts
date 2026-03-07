import { db, products } from './index'
import { eq } from 'drizzle-orm'

async function seed() {
  // Idempotent: only insert if product doesn't already exist by name
  const existing = await db.select({ name: products.name }).from(products)
  const existingNames = new Set(existing.map(p => p.name))

  const toInsert = [
    {
      name: 'Kobo Note Up',
      url: 'https://kobo-up.runawayup.com/',
      description: 'Browser-based tool to export Kobo e-reader highlights, notes, and stylus handwriting annotations. 100% local (WebAssembly), no server, no data upload.',
      problemsSolved: "Kobo's official export randomly fails, ignores sideloaded books, truncates long highlights, doesn't export stylus annotations",
      features: 'Auto-detects KoboReader.sqlite, supports sideloaded books, exports highlight colors, stylus ink annotations, Markdown and plain text export',
      targetAudience: 'Kobo e-reader owners who want to export highlights to Obsidian, Notion, Markdown, or plain text',
      replyTone: 'helpful and friendly, casual indie maker',
      promotionIntensity: 'moderate',
      keywords: JSON.stringify([
        'kobo highlights export', 'kobo notes export', 'kobo export not working',
        'kobo sideloaded books', 'kobo obsidian', 'kobo stylus annotations',
        'export ebook highlights',
      ]),
      subreddits: JSON.stringify([
        'kobo', 'ObsidianMD', 'Notion', 'ebooks', 'kindle',
        'productivity', 'readingandwriting', 'selfhosted',
      ]),
      isActive: true,
    },
    {
      name: 'txtconv',
      url: 'https://txtconv.arpuli.com/',
      description: 'Online Simplified Chinese to Traditional Chinese converter for plain text files, subtitles (SRT), CSV, and XML. Supports batch conversion and custom dictionary overrides.',
      problemsSolved: 'Existing converters are inaccurate for domain-specific vocabulary (tech, media, fiction); no support for file batch conversion; poor support for subtitle formats',
      features: 'Supports .txt, .srt, .csv, .xml; custom dictionary with up to 10,000 entries; batch file conversion; browser-based',
      targetAudience: 'Chinese readers, subtitle editors, bloggers converting Simplified Chinese novels, subtitles, or documents to Traditional Chinese (Taiwan/Hong Kong)',
      replyTone: 'helpful and friendly',
      promotionIntensity: 'moderate',
      keywords: JSON.stringify([
        'simplified to traditional chinese', '簡繁轉換', 'srt subtitle converter',
        'chinese text converter', 'kobo chinese ebook',
      ]),
      subreddits: JSON.stringify([
        'ChineseLanguage', 'translator', 'kdrama', 'anime', 'learnChinese',
        'hongkong', 'taiwan',
      ]),
      isActive: true,
    },
  ]

  const filtered = toInsert.filter(p => !existingNames.has(p.name))
  if (filtered.length === 0) {
    console.log('✅ Products already seeded — nothing to insert')
    process.exit(0)
  }

  await db.insert(products).values(filtered)
  console.log(`✅ Seeded ${filtered.length} product(s) successfully`)
  process.exit(0)
}

seed().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})
