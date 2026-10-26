/** Plain-language EN/ZH explanations for common axe-core rules, plus WCAG Understanding links. */
import type { Locale } from '../i18n.ts';

type Who = 'sr' | 'kb' | 'low' | 'cb' | 'cog' | 'mob' | 'voice' | 'all';
const WHO: Record<'en' | 'zh', Record<Who, string>> = {
  en: { sr: 'screen reader users', kb: 'keyboard-only users', low: 'people with low vision', cb: 'people with colour vision deficiencies', cog: 'people with cognitive or learning disabilities', mob: 'mobile and zoom users', voice: 'voice control users', all: 'all visitors using assistive technology' },
  zh: { sr: '读屏软件用户', kb: '仅使用键盘的用户', low: '低视力用户', cb: '色觉障碍用户', cog: '有认知或学习障碍的用户', mob: '移动设备和页面缩放用户', voice: '语音控制用户', all: '所有使用辅助技术的访问者' },
};
type Text = { what: string; fix: string };
interface Info { who: Who[]; en: Text; zh: Text }
const R: Record<string, Info> = {
  'image-alt': { who: ['sr', 'voice'], en: { what: 'An image has no text alternative, so its meaning is lost when it cannot be seen.', fix: 'Add an alt attribute that describes the purpose of the image, or alt="" if it is purely decorative.' }, zh: { what: '图片没有替代文本，看不到图片的人无法获知其含义。', fix: '添加描述图片用途的 alt 属性；纯装饰性图片请使用 alt=""。' } },
  'color-contrast': { who: ['low', 'cb'], en: { what: 'The text colour does not stand out enough from its background to be read comfortably.', fix: 'Darken the text or lighten the background until the contrast is at least 4.5:1 (3:1 for large text).' }, zh: { what: '文字颜色与背景的对比度不足，难以轻松阅读。', fix: '加深文字颜色或调浅背景，使对比度至少达到 4.5:1（大号文字为 3:1）。' } },
  'label': { who: ['sr', 'voice', 'cog'], en: { what: 'A form field has no label, so people do not know what to enter.', fix: 'Connect a visible <label for="…"> to the field, or add aria-label if a visible label is not possible.' }, zh: { what: '表单字段没有标签，用户不知道应该输入什么。', fix: '用 <label for="…"> 为字段关联一个可见标签；无法显示标签时添加 aria-label。' } },
  'link-name': { who: ['sr', 'voice'], en: { what: 'A link has no readable name, so it is announced only as "link".', fix: 'Put descriptive text inside the link, or add an aria-label / alt text on an image link.' }, zh: { what: '链接没有可读名称，读屏软件只会读出"链接"。', fix: '在链接中加入描述性文字，或为图片链接添加 aria-label / alt 文本。' } },
  'button-name': { who: ['sr', 'voice'], en: { what: 'A button has no accessible name, so its action is unclear.', fix: 'Give the button visible text, or an aria-label when it only shows an icon.' }, zh: { what: '按钮没有可访问名称，用户无法得知它的作用。', fix: '为按钮添加可见文字；仅有图标时添加 aria-label。' } },
  'html-has-lang': { who: ['sr'], en: { what: 'The page does not declare its language, so screen readers may use the wrong pronunciation.', fix: 'Add a lang attribute to the <html> element, for example <html lang="en">.' }, zh: { what: '页面没有声明语言，读屏软件可能使用错误的发音。', fix: '为 <html> 元素添加 lang 属性，例如 <html lang="zh-CN">。' } },
  'html-lang-valid': { who: ['sr'], en: { what: 'The page language code is not valid.', fix: 'Use a valid language code such as "en", "de" or "zh-CN".' }, zh: { what: '页面的语言代码无效。', fix: '使用有效的语言代码，例如 "en"、"de" 或 "zh-CN"。' } },
  'document-title': { who: ['sr', 'cog'], en: { what: 'The page has no title, which makes tabs and history hard to tell apart.', fix: 'Add a short, unique <title> that describes the page.' }, zh: { what: '页面没有标题，难以区分浏览器标签页和历史记录。', fix: '添加一个简短、唯一且能描述页面的 <title>。' } },
  'heading-order': { who: ['sr', 'cog'], en: { what: 'Heading levels skip steps, which makes the page structure confusing.', fix: 'Use headings in order (h1, then h2, then h3) and style them with CSS instead of picking levels by size.' }, zh: { what: '标题层级出现跳跃，页面结构令人困惑。', fix: '按顺序使用标题（h1、h2、h3），用 CSS 控制样式而不是按字号选择层级。' } },
  'page-has-heading-one': { who: ['sr'], en: { what: 'The page has no main heading (h1) to jump to.', fix: 'Add one h1 that describes the main content of the page.' }, zh: { what: '页面没有可以快速跳转到的主标题（h1）。', fix: '添加一个描述页面主要内容的 h1。' } },
  'landmark-one-main': { who: ['sr', 'kb'], en: { what: 'The page has no main landmark, so people cannot skip straight to the content.', fix: 'Wrap the main content in a <main> element.' }, zh: { what: '页面没有 main 地标，用户无法直接跳到主要内容。', fix: '用 <main> 元素包裹页面主要内容。' } },
  'region': { who: ['sr'], en: { what: 'Some content sits outside any landmark, so it is easy to miss when navigating by region.', fix: 'Place all content inside landmarks such as <header>, <nav>, <main> and <footer>.' }, zh: { what: '部分内容不在任何地标中，按区域导航时容易被遗漏。', fix: '将所有内容放入 <header>、<nav>、<main>、<footer> 等地标中。' } },
  'list': { who: ['sr'], en: { what: 'A list contains elements that are not list items, so it is announced incorrectly.', fix: 'Only put <li> elements (or script/template) directly inside <ul> and <ol>.' }, zh: { what: '列表中包含非列表项元素，读屏软件会错误地朗读。', fix: '<ul> 和 <ol> 中只直接放置 <li>（或 script/template）元素。' } },
  'listitem': { who: ['sr'], en: { what: 'A list item is not inside a list.', fix: 'Wrap <li> elements in a <ul> or <ol>.' }, zh: { what: '列表项不在列表中。', fix: '将 <li> 元素放在 <ul> 或 <ol> 中。' } },
  'aria-allowed-attr': { who: ['sr'], en: { what: 'An element uses an ARIA attribute that does not fit its role, which can confuse assistive technology.', fix: 'Remove the attribute or change the element to a role that supports it.' }, zh: { what: '元素使用了与其角色不匹配的 ARIA 属性，可能让辅助技术产生混淆。', fix: '删除该属性，或改用支持该属性的角色。' } },
  'aria-required-attr': { who: ['sr'], en: { what: 'An element with an ARIA role is missing attributes the role needs.', fix: 'Add the required attributes, for example aria-checked on role="checkbox".' }, zh: { what: '带有 ARIA 角色的元素缺少该角色必需的属性。', fix: '补充必需属性，例如为 role="checkbox" 添加 aria-checked。' } },
  'aria-valid-attr-value': { who: ['sr'], en: { what: 'An ARIA attribute has an invalid value.', fix: 'Use an allowed value, and make sure IDs referenced by aria-labelledby or aria-controls exist.' }, zh: { what: 'ARIA 属性的值无效。', fix: '使用允许的值，并确认 aria-labelledby、aria-controls 引用的 ID 确实存在。' } },
  'aria-valid-attr': { who: ['sr'], en: { what: 'An ARIA attribute name is misspelled or does not exist.', fix: 'Correct the attribute name or remove it.' }, zh: { what: 'ARIA 属性名称拼写错误或不存在。', fix: '更正属性名称或将其删除。' } },
  'aria-hidden-focus': { who: ['sr', 'kb'], en: { what: 'A hidden element (aria-hidden) can still receive keyboard focus, so focus lands on something that is not announced.', fix: 'Remove aria-hidden, or make the focusable content inside it unfocusable (tabindex="-1" or inert).' }, zh: { what: '被 aria-hidden 隐藏的元素仍能获得键盘焦点，焦点会落在不会被朗读的内容上。', fix: '删除 aria-hidden，或让其中可聚焦的内容不可聚焦（tabindex="-1" 或 inert）。' } },
  'aria-roles': { who: ['sr'], en: { what: 'An element uses a role that does not exist.', fix: 'Use a valid ARIA role, or better, a native HTML element.' }, zh: { what: '元素使用了不存在的角色。', fix: '使用有效的 ARIA 角色，最好直接使用原生 HTML 元素。' } },
  'aria-prohibited-attr': { who: ['sr'], en: { what: 'An ARIA attribute is not allowed on this element, so the label may be ignored.', fix: 'Remove the attribute or put the label text in visible content.' }, zh: { what: '该元素不允许使用此 ARIA 属性，标签可能会被忽略。', fix: '删除该属性，或将标签文字放入可见内容中。' } },
  'frame-title': { who: ['sr'], en: { what: 'An iframe has no title, so people do not know what it contains.', fix: 'Add a title attribute that describes the frame, for example title="Map".' }, zh: { what: 'iframe 没有标题，用户不知道其中的内容。', fix: '添加描述框架内容的 title 属性，例如 title="地图"。' } },
  'meta-viewport': { who: ['low', 'mob'], en: { what: 'The page blocks zooming on mobile devices.', fix: 'Remove user-scalable=no and maximum-scale below 2 from the viewport meta tag.' }, zh: { what: '页面在移动设备上禁止缩放。', fix: '从 viewport meta 标签中删除 user-scalable=no 以及小于 2 的 maximum-scale。' } },
  'input-image-alt': { who: ['sr', 'voice'], en: { what: 'An image button has no text alternative.', fix: 'Add alt text that describes the action, for example alt="Search".' }, zh: { what: '图片按钮没有替代文本。', fix: '添加描述操作的 alt 文本，例如 alt="搜索"。' } },
  'select-name': { who: ['sr', 'voice'], en: { what: 'A dropdown has no label.', fix: 'Connect a visible <label> to the <select>.' }, zh: { what: '下拉菜单没有标签。', fix: '为 <select> 关联一个可见的 <label>。' } },
  'empty-heading': { who: ['sr'], en: { what: 'A heading is empty, so it is announced without content.', fix: 'Add text to the heading or remove the empty heading element.' }, zh: { what: '标题为空，读屏软件会朗读一个没有内容的标题。', fix: '为标题添加文字，或删除空的标题元素。' } },
  'nested-interactive': { who: ['sr', 'kb'], en: { what: 'An interactive element is nested inside another, so one of them may be unreachable or announced wrongly.', fix: 'Do not put links or buttons inside other links or buttons; place them side by side.' }, zh: { what: '交互元素嵌套在另一个交互元素中，其中一个可能无法访问或被错误朗读。', fix: '不要在链接或按钮内部再放链接或按钮，改为并列放置。' } },
  'scrollable-region-focusable': { who: ['kb'], en: { what: 'A scrollable area cannot be reached with the keyboard, so its content cannot be scrolled.', fix: 'Add tabindex="0" and an accessible name to the scrollable container, or make sure it contains focusable content.' }, zh: { what: '可滚动区域无法用键盘访问，其中的内容无法滚动查看。', fix: '为滚动容器添加 tabindex="0" 和可访问名称，或确保其中包含可聚焦内容。' } },
  'role-img-alt': { who: ['sr'], en: { what: 'An element with role="img" has no text alternative.', fix: 'Add aria-label or aria-labelledby describing the image.' }, zh: { what: 'role="img" 的元素没有替代文本。', fix: '添加描述图像的 aria-label 或 aria-labelledby。' } },
  'svg-img-alt': { who: ['sr'], en: { what: 'An SVG image has no text alternative.', fix: 'Add a <title> inside the SVG or an aria-label on it; use aria-hidden="true" if it is decorative.' }, zh: { what: 'SVG 图像没有替代文本。', fix: '在 SVG 中添加 <title> 或 aria-label；装饰性图像请使用 aria-hidden="true"。' } },
  'link-in-text-block': { who: ['cb', 'low'], en: { what: 'A link inside text is only distinguished by colour.', fix: 'Underline links in body text, or give them another visual cue besides colour.' }, zh: { what: '正文中的链接仅靠颜色区分。', fix: '为正文链接添加下划线，或提供颜色之外的其他视觉提示。' } },
  'duplicate-id-aria': { who: ['sr'], en: { what: 'An ID used by ARIA or a label appears more than once, so the wrong element may be referenced.', fix: 'Make every id on the page unique.' }, zh: { what: 'ARIA 或标签引用的 ID 重复出现，可能引用到错误的元素。', fix: '确保页面上每个 id 都是唯一的。' } },
  'landmark-unique': { who: ['sr'], en: { what: 'Several landmarks of the same type have the same name, so they are hard to tell apart.', fix: 'Give each landmark a distinct aria-label, for example "Main menu" and "Footer menu".' }, zh: { what: '多个同类地标名称相同，难以区分。', fix: '为每个地标设置不同的 aria-label，例如"主菜单"和"页脚菜单"。' } },
  'bypass': { who: ['kb', 'sr'], en: { what: 'There is no way to skip repeated content such as the navigation.', fix: 'Add a "Skip to content" link at the top, or use a <main> landmark.' }, zh: { what: '没有办法跳过导航等重复内容。', fix: '在页面顶部添加"跳到主要内容"链接，或使用 <main> 地标。' } },
  'autocomplete-valid': { who: ['cog', 'mob'], en: { what: 'A form field uses an invalid autocomplete value, so browsers cannot fill it in.', fix: 'Use a standard token such as "email", "name" or "postal-code".' }, zh: { what: '表单字段的 autocomplete 值无效，浏览器无法自动填充。', fix: '使用标准值，例如 "email"、"name" 或 "postal-code"。' } },
  'image-redundant-alt': { who: ['sr'], en: { what: 'The alt text repeats text that is already next to the image, so it is read twice.', fix: 'Shorten the alt text or use alt="" when the nearby text already says it.' }, zh: { what: '替代文本重复了图片旁已有的文字，会被朗读两次。', fix: '缩短替代文本；如果旁边文字已说明，请使用 alt=""。' } },
};
const GENERIC = {
  en: { what: 'Automated checks found a pattern that can make this content harder to use with assistive technology.', who: 'people using assistive technology', fix: 'Open the rule guide for details, then fix the elements listed below and scan again.' },
  zh: { what: '自动化检测发现了一种可能让辅助技术用户更难使用此内容的模式。', who: '使用辅助技术的用户', fix: '打开规则说明了解详情，修复下面列出的元素后重新扫描。' },
};
export const RULE_INFO_IDS = Object.keys(R);
export function ruleInfo(ruleId: string, l: Locale | string = 'en'): { what: string; who: string; fix: string; generic: boolean } {
  const k = String(l).startsWith('zh') ? 'zh' : 'en';
  const r = R[ruleId];
  if (!r) return { ...GENERIC[k], generic: true };
  return { what: r[k].what, fix: r[k].fix, who: r.who.map((w) => WHO[k][w]).join(k === 'zh' ? '、' : ', '), generic: false };
}

const SC: Record<string, string> = {
  '1.1.1': 'non-text-content', '1.2.2': 'captions-prerecorded', '1.3.1': 'info-and-relationships', '1.3.4': 'orientation', '1.3.5': 'identify-input-purpose',
  '1.4.1': 'use-of-color', '1.4.2': 'audio-control', '1.4.3': 'contrast-minimum', '1.4.4': 'resize-text', '1.4.6': 'contrast-enhanced', '1.4.10': 'reflow', '1.4.11': 'non-text-contrast', '1.4.12': 'text-spacing',
  '2.1.1': 'keyboard', '2.2.1': 'timing-adjustable', '2.2.2': 'pause-stop-hide', '2.4.1': 'bypass-blocks', '2.4.2': 'page-titled', '2.4.3': 'focus-order', '2.4.4': 'link-purpose-in-context',
  '2.4.6': 'headings-and-labels', '2.4.7': 'focus-visible', '2.5.3': 'label-in-name', '2.5.8': 'target-size-minimum', '3.1.1': 'language-of-page', '3.1.2': 'language-of-parts',
  '3.3.2': 'labels-or-instructions', '4.1.2': 'name-role-value', '4.1.3': 'status-messages',
};
/** "WCAG 1.4.3 (AA)" → link to the W3C Understanding page (index page when the SC is unknown). */
export function wcagLink(ref: string): { ref: string; url: string } {
  const sc = ref.match(/(\d\.\d\.\d{1,2})/)?.[1] ?? '';
  if (sc === '4.1.1') return { ref, url: 'https://www.w3.org/WAI/WCAG21/Understanding/parsing' };
  return { ref, url: SC[sc] ? `https://www.w3.org/WAI/WCAG22/Understanding/${SC[sc]}` : 'https://www.w3.org/WAI/WCAG22/Understanding/' };
}
