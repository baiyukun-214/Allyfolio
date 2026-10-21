export type Locale = 'en' | 'zh-CN';
// The site is English-only today; any page under /zh/ is treated as zh-CN so the header/footer are ready for it.
export const localeFromPath = (path: string): Locale => (/^\/zh(\/|\.html$|$)/.test(path) ? 'zh-CN' : 'en');
const dict = {
  en: { login: 'Log in', signup: 'Sign up', account: 'Account' },
  'zh-CN': { login: '登录', signup: '注册', account: '账户' },
} as const;
export const t = (l: Locale) => dict[l];
