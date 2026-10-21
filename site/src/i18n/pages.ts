import type { Locale } from './index';
const DEQUE = 'https://www.deque.com/automated-accessibility-testing-coverage/';
const MAIL = '<a href="mailto:hello@allyfolio.com">hello@allyfolio.com</a>';
export interface ProsePage { eyebrow: 'legal' | 'about'; title: string; description: string; html: string }
type Pages = Record<'about' | 'privacy' | 'imprint' | 'statement', ProsePage>;
export const prosePages: Record<Locale, Pages> = {
  en: {
    about: { eyebrow: 'about', title: 'About Allyfolio', description: 'Why we are building Allyfolio: honest, evidence-based accessibility monitoring for EU SMEs and web agencies.', html: `
<p>Allyfolio is a small, independent side project built for European SMEs and web agencies facing the European Accessibility Act (EAA) and Germany's BFSG.</p>
<h2>What we believe</h2>
<ul>
<li><strong>Fix the code, not the symptoms.</strong> We will never sell an overlay widget.</li>
<li><strong>Be honest about automation.</strong> Automated testing finds roughly 57% of issues (<a href="${DEQUE}">Deque study</a>). People still need to review the rest.</li>
<li><strong>Evidence over promises.</strong> A dated record of real work is worth more than a badge.</li>
</ul>
<h2>Contact</h2>
<p>Questions or feedback? Email ${MAIL}.</p>
<!-- TODO: add founder name/bio if desired -->` },
    privacy: { eyebrow: 'legal', title: 'Privacy policy', description: 'How Allyfolio handles personal data on allyfolio.com.', html: `
<!-- TODO: have this privacy policy reviewed (GDPR / DSGVO) and add controller details before launch. -->
<p><em>Draft.</em></p>
<h2>Summary</h2>
<p>This website does not use cookies, analytics or tracking scripts. It is a static site.</p>
<h2>Hosting</h2>
<p>The site is served by Cloudflare Pages. Cloudflare may process technical data such as IP addresses in server logs to deliver and secure the site. <!-- TODO: link Cloudflare DPA and confirm details --></p>
<h2>Email and waitlist</h2>
<p>If you join the waitlist or email us, we use your email address only to reply and to tell you about the Allyfolio launch. You can ask us to delete it at any time.</p>
<h2>Your rights</h2>
<p>Under the GDPR you have the right to access, correct, delete and restrict processing of your data, and to complain to a supervisory authority. Contact ${MAIL}.</p>` },
    imprint: { eyebrow: 'legal', title: 'Imprint', description: 'Legal notice (Impressum) for allyfolio.com.', html: `
<!-- TODO: fill in legal details required by § 5 DDG (name, postal address, contact, VAT ID if any, responsible person). -->
<p><strong>Placeholder.</strong> Legal details will be added before launch.</p>
<h2>Provider</h2>
<p>[Name – TODO]<br />[Street and number – TODO]<br />[Postcode and city – TODO]<br />[Country – TODO]</p>
<h2>Contact</h2>
<p>Email: ${MAIL}</p>
<h2>VAT ID</h2>
<p>[TODO, if applicable]</p>` },
    statement: { eyebrow: 'legal', title: 'Accessibility statement', description: 'Accessibility statement for allyfolio.com: our target standard, testing methods, known limitations and how to give feedback.', html: `
<p>We want allyfolio.com to be usable by everyone. We aim to meet WCAG 2.2 level AA.</p>
<h2>How we test</h2>
<ul>
<li>Automated checks with axe-core on every page, in English and Chinese, before each release.</li>
<li>Keyboard-only navigation checks.</li>
<li>Checks for reduced motion, zoom up to 200% and colour contrast.</li>
</ul>
<p>Automated testing finds only part of the issues, so we also review pages manually. <!-- TODO: add screen-reader testing (NVDA, VoiceOver) results --></p>
<h2>Known limitations</h2>
<ul>
<li>The waitlist and free scan forms need JavaScript for inline results; without it, the waitlist form still submits and shows a confirmation page.</li>
</ul>
<h2>No overlay</h2>
<p>This site does not use an accessibility overlay widget.</p>
<h2>Feedback</h2>
<p>If you find a barrier, please email ${MAIL}. We aim to reply within 5 working days.</p>` },
  },
  'zh-CN': {
    about: { eyebrow: 'about', title: '关于 Allyfolio', description: '我们为什么打造 Allyfolio：为欧盟中小企业和网页代理商提供诚实、以证据为基础的无障碍监测。', html: `
<p>Allyfolio 是一个小型独立项目，服务于面临《欧洲无障碍法案》（EAA）和德国 BFSG 要求的欧洲中小企业和网页代理商。</p>
<h2>我们的理念</h2>
<ul>
<li><strong>修复代码，而不是掩盖症状。</strong>我们永远不会销售覆盖层插件。</li>
<li><strong>如实说明自动化的局限。</strong>自动化测试大约能发现 57% 的问题（<a href="${DEQUE}">Deque 研究</a>），其余部分仍需人工审查。</li>
<li><strong>证据胜于承诺。</strong>一份带日期的真实工作记录，比一枚徽章更有价值。</li>
</ul>
<h2>联系我们</h2>
<p>有问题或建议？请发送邮件至 ${MAIL}。</p>` },
    privacy: { eyebrow: 'legal', title: '隐私政策', description: 'Allyfolio 如何在 allyfolio.com 上处理个人数据。', html: `
<p><em>草稿。</em>如中文版与英文版存在差异，以英文版为准。</p>
<h2>概要</h2>
<p>本网站不使用 Cookie、分析工具或跟踪脚本。这是一个静态网站。</p>
<h2>托管</h2>
<p>本网站由 Cloudflare Pages 提供服务。Cloudflare 可能会在服务器日志中处理 IP 地址等技术数据，以便提供和保护网站。</p>
<h2>邮件与候补名单</h2>
<p>如果您加入候补名单或给我们发送邮件，我们只会使用您的邮箱地址回复您，并告知您 Allyfolio 上线的消息。您可以随时要求我们删除。</p>
<h2>您的权利</h2>
<p>根据《通用数据保护条例》（GDPR），您有权访问、更正、删除和限制处理您的数据，并有权向监管机构投诉。请联系 ${MAIL}。</p>` },
    imprint: { eyebrow: 'legal', title: '网站信息（Impressum）', description: 'allyfolio.com 的法定网站信息（Impressum）。', html: `
<p><strong>占位内容。</strong>法定信息将在正式上线前补充。具有法律效力的是德文/英文版本。</p>
<h2>提供者</h2>
<p>[名称 – 待补充]<br />[街道和门牌号 – 待补充]<br />[邮编和城市 – 待补充]<br />[国家 – 待补充]</p>
<h2>联系方式</h2>
<p>邮箱：${MAIL}</p>
<h2>增值税号</h2>
<p>[待补充，如适用]</p>` },
    statement: { eyebrow: 'legal', title: '无障碍声明', description: 'allyfolio.com 的无障碍声明：目标标准、测试方法、已知局限以及反馈方式。', html: `
<p>我们希望每个人都能使用 allyfolio.com。我们的目标是达到 WCAG 2.2 AA 级。</p>
<h2>我们如何测试</h2>
<ul>
<li>每次发布前，用 axe-core 对每个页面（英文和中文）进行自动化检测。</li>
<li>仅使用键盘的导航检查。</li>
<li>减少动态效果、最高 200% 缩放和颜色对比度检查。</li>
</ul>
<p>自动化测试只能发现部分问题，因此我们也会人工审查页面。</p>
<h2>已知局限</h2>
<ul>
<li>候补名单和免费扫描表单需要 JavaScript 才能在页面内显示结果；如果没有 JavaScript，候补名单表单仍可提交并显示确认页面。</li>
</ul>
<h2>不使用覆盖层</h2>
<p>本网站不使用无障碍覆盖层插件。</p>
<h2>反馈</h2>
<p>如果您遇到障碍，请发送邮件至 ${MAIL}。我们会尽量在 5 个工作日内回复。</p>` },
  },
};
