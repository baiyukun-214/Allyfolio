// English ~200 words/min; Chinese ~400 characters/min.
export const readingTime = (body = '', lang = 'en') => lang === 'zh-CN'
  ? Math.max(1, Math.round((body.match(/[\u4e00-\u9fff]/g)?.length ?? 0) / 400))
  : Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 200));
