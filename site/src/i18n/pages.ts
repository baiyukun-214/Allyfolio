import type { Locale } from './index';
const DEQUE = 'https://www.deque.com/automated-accessibility-testing-coverage/';
const MAIL = '<a href="mailto:hello@allyfolio.com">hello@allyfolio.com</a>';
export interface ProsePage { eyebrow: 'legal' | 'about'; title: string; description: string; html: string }
type Pages = Record<'about' | 'privacy' | 'imprint' | 'statement' | 'terms' | 'dpa', ProsePage>;
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
    privacy: { eyebrow: 'legal', title: 'Privacy policy', description: 'How Allyfolio handles personal data: website, waitlist, accounts, scans, billing and email. Processors, retention and your GDPR rights.', html: `
<!-- TODO: have this policy reviewed (GDPR / DSGVO) before launch. -->
<p>This policy explains what personal data Allyfolio processes on allyfolio.com and app.allyfolio.com, why, and for how long.</p>
<h2>Controller</h2>
<p>The controller is Xiamen Miaoerduo Trading Co., Ltd. (厦门妙尔多商贸有限公司), Room 907, No. 221 Jiahe Road, Siming District, Xiamen, Fujian, China, represented by its managing director Bai Yukun (see the <a href="/imprint">imprint</a>). Contact: ${MAIL}.</p>
<h2>Cookies</h2>
<p>We use <strong>only essential cookies</strong>, so there is no cookie banner. There are no analytics, advertising or tracking cookies or scripts.</p>
<ul>
<li><code>af_session</code> (app, HttpOnly): keeps you logged in; up to 30 days.</li>
<li><code>af_csrf</code> (app): protects forms against cross-site request forgery.</li>
<li><code>af_lang</code>: remembers your language choice; 1 year.</li>
<li><code>af_logged_in=1</code> (no personal data): tells the website to show “Dashboard” instead of “Log in”; removed when you log out.</li>
</ul>
<h2>Website visits</h2>
<p>When you visit the site, our servers process your IP address, the requested page, date and time and your browser’s user agent to deliver the site and protect it against abuse (Art. 6(1)(f) GDPR). Server logs are kept for up to 14 days.</p>
<h2>Waitlist</h2>
<p>If you join the waitlist, we store your email address, language, the time you joined and the time you confirmed (double opt-in). We use it only to tell you about the launch and early-bird pricing (Art. 6(1)(a) GDPR, consent). You can withdraw consent at any time via the link in each email or by writing to us; we then delete the entry.</p>
<h2>Free scan</h2>
<p>For a free scan we process the URL you enter and your IP address (to limit abuse; kept in memory for at most one hour). The scan results are shown to you and not linked to a person.</p>
<h2>Accounts</h2>
<p>If you create an account we process your email address, name (optional), a password hash (never the password itself), language, team memberships, invitations and login sessions to provide the service (Art. 6(1)(b) GDPR). You can download all of this data as a file in Settings (“Download my data”) and delete your account there at any time.</p>
<h2>Scan data</h2>
<p>For monitored sites we store the site address, ownership verification, the pages scanned, the issues found (including short HTML snippets of the affected elements) and the reports and statement drafts you create. Scan pages may by chance contain personal data published on your website; you are the controller for that content and we process it on your behalf under our <a href="/dpa">data processing agreement</a>. Scan history is kept for 12 months (Starter) or 24 months (Business, Agency) and deleted afterwards, or earlier when you delete a site or your account.</p>
<h2>Billing</h2>
<p>Payments are handled by <strong>Paddle</strong> (Paddle.com Market Ltd, UK), which acts as Merchant of Record: Paddle is the seller of record, collects payment details, issues invoices and handles VAT. Paddle processes your payment and billing data as an independent controller under its own privacy notice. We receive your customer and subscription IDs, plan, status and billing period, not your card details.</p>
<h2>Email</h2>
<p>Transactional emails (login links, password resets, invitations, alerts, receipts of account changes) are sent via <strong>Resend</strong> from servers in the EU (Ireland region). Emails you send to ${MAIL} are received through <strong>Cloudflare</strong> Email Routing and forwarded to our mailbox.</p>
<h2>Processors</h2>
<ul>
<li><strong>Hetzner Online GmbH</strong> (Germany): servers and data storage in the EU (Germany/Finland).</li>
<li><strong>Cloudflare, Inc.</strong>: DNS and inbound email routing. Data may be processed outside the EU; covered by the EU Standard Contractual Clauses and the EU-US Data Privacy Framework.</li>
<li><strong>Resend</strong> (Plus Five Five, Inc.): sending transactional email; EU region; transfers covered by Standard Contractual Clauses.</li>
<li><strong>Paddle</strong>: payments as Merchant of Record (independent controller, see above).</li>
</ul>
<p>Backups of our database are encrypted in transit and kept for up to 30 days. <!-- TODO: name offsite backup location if used --></p>
<h2>Your rights</h2>
<p>Under the GDPR you have the right to access, rectify, erase, restrict and port your data, to object to processing based on legitimate interests and to withdraw consent. You can also complain to a data protection supervisory authority. Contact ${MAIL}.</p>` },
    terms: { eyebrow: 'legal', title: 'Terms of Service', description: 'Terms of Service for Allyfolio: what the service does and does not do, ownership verification, payment via Paddle, liability and termination.', html: `
<!-- TODO: have these terms reviewed by a lawyer before launch. -->
<p>These terms apply to the use of Allyfolio (allyfolio.com and app.allyfolio.com), operated by Xiamen Miaoerduo Trading Co., Ltd. (厦门妙尔多商贸有限公司) (see the <a href="/imprint">imprint</a>; “we”). They apply to business customers only; Allyfolio is not offered to consumers.</p>
<h2>1. What Allyfolio does</h2>
<p>Allyfolio runs automated accessibility checks (axe-core, against WCAG 2.2 success criteria) on web pages, keeps a dated history of the results and helps you create reports and a draft accessibility statement.</p>
<h2>2. What Allyfolio does not do</h2>
<ul>
<li>Automated testing finds only part of all accessibility issues – roughly 57% according to a <a href="${DEQUE}">Deque study</a>. Manual review by people, including assistive technology users, is still needed.</li>
<li>Scan results, reports and statement drafts are <strong>not proof that a website meets legal requirements</strong> such as the European Accessibility Act, the BFSG or EN 301 549, and are not a legal opinion. They do not replace an audit or legal advice. You remain responsible for your website and for any statement you publish.</li>
<li>Allyfolio does not change your website and does not provide an overlay widget.</li>
</ul>
<h2>3. Accounts</h2>
<p>You must give accurate information and keep your password secret. You are responsible for activity in your account and your team. Team owners decide who is a member.</p>
<h2>4. Scanning and ownership verification</h2>
<ul>
<li>Monitoring, multi-page scans and full-site crawls are only available for sites whose ownership (or your authorisation to test) you have <strong>verified</strong> with a DNS TXT record or a meta tag. Do not scan sites you are not authorised to test.</li>
<li>The free single-page scan may be used only on publicly accessible pages, within the stated rate limits.</li>
<li>You must not use Allyfolio to overload, attack or probe systems, or to reach non-public addresses.</li>
</ul>
<h2>5. Prices, payment and cancellation</h2>
<p>Orders are processed by our reseller and Merchant of Record, <strong>Paddle</strong> (Paddle.com Market Ltd), which handles payment, invoicing and VAT; Paddle’s buyer terms also apply to the purchase. Subscriptions are billed monthly in advance and can be cancelled at any time with effect from the end of the current billing period. Upgrades take effect immediately and are charged pro rata; downgrades take effect at the next billing period. The one-off report (€49) covers a single scan of one site. Prices exclude VAT unless stated otherwise.</p>
<h2>6. Availability and changes</h2>
<p>We aim for high availability but do not promise uninterrupted service. Scheduled scans may be delayed by maintenance or by the target website. We may change features if the core service you pay for is not substantially reduced; we will announce material changes to these terms at least 30 days in advance by email.</p>
<h2>7. Liability</h2>
<ul>
<li>We are liable without limitation for intent and gross negligence, for injury to life, body or health, and under mandatory product liability law.</li>
<li>For slight negligence we are liable only for breach of essential contractual obligations, limited to the typical, foreseeable damage.</li>
<li>In all other cases, and to the extent permitted by law, our total liability per contract year is limited to the fees you paid for Allyfolio in the twelve months before the event giving rise to the claim (and at least €100).</li>
<li>We are not liable for fines, claims or warnings from third parties based on the accessibility of your website, unless caused by our intent or gross negligence.</li>
</ul>
<h2>8. Data protection</h2>
<p>See the <a href="/privacy">privacy policy</a>. Where we process personal data on your behalf (for example content of scanned pages), the <a href="/dpa">data processing agreement</a> applies.</p>
<h2>9. Termination</h2>
<p>You can delete your account at any time in Settings; an active subscription is cancelled at the same time. We may suspend or terminate accounts that breach these terms, especially section 4.</p>
<h2>10. Final provisions</h2>
<p>German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. Place of jurisdiction for merchants is the registered seat of the provider. If a provision is invalid, the rest remains effective.</p>` },
    dpa: { eyebrow: 'legal', title: 'Data processing agreement (template)', description: 'Template data processing agreement (Art. 28 GDPR) between Allyfolio customers and Allyfolio for personal data contained in scanned web pages.', html: `
<!-- TODO: have this DPA template reviewed before launch. -->
<p><em>Template.</em> This agreement under Art. 28 GDPR applies between you as a customer (“controller”) and Xiamen Miaoerduo Trading Co., Ltd. (厦门妙尔多商贸有限公司), Room 907, No. 221 Jiahe Road, Siming District, Xiamen, Fujian, China (see the <a href="/imprint">imprint</a>; “processor”) when you use Allyfolio. It becomes part of the contract when you accept the <a href="/terms">Terms of Service</a>. If you need a signed copy, email ${MAIL}.</p>
<h2>1. Subject, duration and nature of processing</h2>
<p>The processor scans web pages that the controller has verified, stores the results and creates reports for the controller. Processing lasts as long as the contract, plus the retention periods below.</p>
<h2>2. Types of data and data subjects</h2>
<ul>
<li>Personal data that happens to be published on the scanned pages (for example names, email addresses or photos of employees or other people) and appears in HTML snippets, screenshots or page titles stored with scan results.</li>
<li>Email addresses and names of team members invited by the controller.</li>
</ul>
<h2>3. Instructions</h2>
<p>The processor processes the data only on documented instructions from the controller – the configuration of sites, scans, reports and team in the dashboard – unless EU or member state law requires otherwise.</p>
<h2>4. Confidentiality</h2>
<p>Everyone with access to the data is bound to confidentiality.</p>
<h2>5. Security (Art. 32 GDPR)</h2>
<ul>
<li>Hosting in the EU (Hetzner, Germany/Finland); encrypted connections (TLS) for all access.</li>
<li>Access to the dashboard only after login; passwords stored as salted hashes; sessions can be ended; reset links are single use and expire after 60 minutes.</li>
<li>Strict separation of customers' data by team; ownership verification before site scans.</li>
<li>Scanner isolated from internal networks by an egress proxy that only allows public addresses.</li>
<li>Daily backups with limited retention; tamper-evident, hash-chained scan history.</li>
</ul>
<h2>6. Sub-processors</h2>
<p>The controller agrees to the following sub-processors: Hetzner Online GmbH (hosting, Germany); Resend (transactional email, EU region); Cloudflare, Inc. (DNS and inbound email). The processor informs the controller of intended changes at least 30 days in advance by email; the controller may object for important reasons and terminate.</p>
<h2>7. Assistance</h2>
<p>The processor helps the controller to answer data subject requests and to meet its obligations under Art. 32–36 GDPR, as far as the nature of the processing allows. Data can be exported from the dashboard at any time.</p>
<h2>8. Personal data breaches</h2>
<p>The processor notifies the controller without undue delay, and where possible within 48 hours, after becoming aware of a personal data breach affecting the controller's data.</p>
<h2>9. Deletion and return</h2>
<p>At the end of the contract, or when the controller deletes a site or the account, the processor deletes the data. Backups are overwritten within 30 days. Before deletion, the controller can export the data.</p>
<h2>10. Audits</h2>
<p>The processor makes available the information needed to show that the obligations under Art. 28 GDPR are met and allows reasonable audits, normally by providing written information, with at least 30 days' notice.</p>` },
    imprint: { eyebrow: 'legal', title: 'Imprint', description: 'Legal notice (Impressum) for allyfolio.com.', html: `
<h2>Provider</h2>
<p>Xiamen Miaoerduo Trading Co., Ltd. (厦门妙尔多商贸有限公司)<br />Room 907, No. 221 Jiahe Road<br />Siming District, Xiamen, Fujian<br />China</p>
<p>Limited liability company registered in the People's Republic of China.<br />Unified Social Credit Code: 91350203MAK7GQ50XC</p>
<h2>Managing director / legal representative</h2>
<p>Bai Yukun (白宇堃)</p>
<h2>Contact</h2>
<p>Email: ${MAIL}</p>` },
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
    privacy: { eyebrow: 'legal', title: '隐私政策', description: 'Allyfolio 如何处理个人数据：网站、候补名单、账户、扫描、付款和电子邮件；处理方、保存期限以及您的 GDPR 权利。', html: `
<!-- TODO: have this policy reviewed (GDPR / DSGVO) before launch. -->
<p>本政策说明 Allyfolio 在 allyfolio.com 和 app.allyfolio.com 上处理哪些个人数据、出于什么目的以及保存多长时间。</p>
<h2>控制者</h2>
<p>控制者为厦门妙尔多商贸有限公司（地址：福建省厦门市思明区嘉禾路221号907室；法定代表人：白宇堃；详见<a href="/zh/imprint">网站信息</a>）。联系方式：${MAIL}。</p>
<h2>Cookie</h2>
<p>我们<strong>仅使用必要的 Cookie</strong>，因此没有 Cookie 横幅。我们不使用任何分析、广告或跟踪 Cookie 或脚本。</p>
<ul>
<li><code>af_session</code>（应用，HttpOnly）：保持登录状态；最长 30 天。</li>
<li><code>af_csrf</code>（应用）：防止跨站请求伪造。</li>
<li><code>af_lang</code>：记住您选择的语言；1 年。</li>
<li><code>af_logged_in=1</code>（不含个人数据）：让网站显示“控制台”而不是“登录”；退出登录时删除。</li>
</ul>
<h2>访问网站</h2>
<p>当您访问本网站时，我们的服务器会处理您的 IP 地址、所请求的页面、日期和时间以及浏览器标识，用于提供网站并防止滥用（GDPR 第 6(1)(f) 条）。服务器日志最多保存 14 天。</p>
<h2>候补名单</h2>
<p>如果您加入候补名单，我们会保存您的电子邮件地址、语言、加入时间和确认时间（双重确认）。我们仅用它通知您产品上线和早鸟价格（GDPR 第 6(1)(a) 条，同意）。您可以随时通过每封邮件中的链接或写信给我们撤回同意，我们随后会删除该记录。</p>
<h2>免费扫描</h2>
<p>进行免费扫描时，我们会处理您输入的网址和您的 IP 地址（用于防止滥用；仅在内存中保存最多一小时）。扫描结果仅显示给您，不与任何个人关联。</p>
<h2>账户</h2>
<p>如果您创建账户，我们会处理您的电子邮件地址、姓名（可选）、密码哈希（从不保存密码本身）、语言、团队成员关系、邀请和登录会话，以提供服务（GDPR 第 6(1)(b) 条）。您可以在“设置”中下载全部数据（“下载我的数据”），也可以随时在那里删除账户。</p>
<h2>扫描数据</h2>
<p>对于受监测的网站，我们会保存网站地址、所有权验证、已扫描的页面、发现的问题（包括相关元素的简短 HTML 片段）以及您创建的报告和声明草稿。扫描的页面可能碰巧包含您网站上公开的个人数据；您是这些内容的控制者，我们根据<a href="/zh/dpa">数据处理协议</a>代表您处理。扫描历史保存 12 个月（入门版）或 24 个月（商业版、代理商版）后删除；删除网站或账户时会提前删除。</p>
<h2>付款</h2>
<p>付款由 <strong>Paddle</strong>（Paddle.com Market Ltd，英国）处理，Paddle 作为记录商户（Merchant of Record）：Paddle 是销售方，负责收集付款信息、开具发票并处理增值税。Paddle 作为独立控制者根据其自身的隐私声明处理您的付款和账单数据。我们只会收到您的客户和订阅 ID、方案、状态和计费周期，不会收到您的银行卡信息。</p>
<h2>电子邮件</h2>
<p>事务性邮件（登录链接、密码重置、邀请、提醒、账户变更通知）通过 <strong>Resend</strong> 从欧盟（爱尔兰区域）的服务器发送。您发送到 ${MAIL} 的邮件通过 <strong>Cloudflare</strong> Email Routing 接收并转发到我们的邮箱。</p>
<h2>数据处理方</h2>
<ul>
<li><strong>Hetzner Online GmbH</strong>（德国）：位于欧盟（德国/芬兰）的服务器和数据存储。</li>
<li><strong>Cloudflare, Inc.</strong>：DNS 和入站邮件转发。数据可能在欧盟以外处理；受欧盟标准合同条款和欧美数据隐私框架约束。</li>
<li><strong>Resend</strong>（Plus Five Five, Inc.）：发送事务性邮件；欧盟区域；数据传输受标准合同条款约束。</li>
<li><strong>Paddle</strong>：作为记录商户处理付款（独立控制者，见上文）。</li>
</ul>
<p>数据库备份在传输中加密，最多保存 30 天。<!-- TODO: name offsite backup location if used --></p>
<h2>您的权利</h2>
<p>根据 GDPR，您有权访问、更正、删除、限制处理和携带您的数据，有权反对基于正当利益的处理，并可撤回同意。您也可以向数据保护监管机构投诉。联系方式：${MAIL}。</p>` },
    terms: { eyebrow: 'legal', title: '服务条款', description: 'Allyfolio 服务条款：服务的作用与局限、所有权验证、通过 Paddle 付款、责任和终止。', html: `
<!-- TODO: have these terms reviewed by a lawyer before launch. -->
<p>本条款适用于使用 Allyfolio（allyfolio.com 和 app.allyfolio.com），运营者为厦门妙尔多商贸有限公司（详见<a href="/zh/imprint">网站信息</a>；“我们”）。本条款仅适用于企业客户；Allyfolio 不面向消费者提供。如中文版本与英文版本有出入，以英文版本为准。</p>
<h2>1. Allyfolio 的作用</h2>
<p>Allyfolio 对网页进行自动化无障碍检查（axe-core，依据 WCAG 2.2 成功标准），保存带日期的结果历史，并帮助您创建报告和无障碍声明草稿。</p>
<h2>2. Allyfolio 不做什么</h2>
<ul>
<li>自动化测试只能发现部分无障碍问题——根据 <a href="${DEQUE}">Deque 的研究</a>约为 57%。仍需要人工审查，包括辅助技术用户的审查。</li>
<li>扫描结果、报告和声明草稿<strong>不能证明网站满足法律要求</strong>（例如《欧洲无障碍法案》、BFSG 或 EN 301 549），也不是法律意见。它们不能替代审计或法律咨询。您仍需对您的网站以及您发布的任何声明负责。</li>
<li>Allyfolio 不会修改您的网站，也不提供覆盖层插件。</li>
</ul>
<h2>3. 账户</h2>
<p>您必须提供准确的信息并对密码保密。您需对您的账户和团队中的活动负责。团队所有者决定谁是成员。</p>
<h2>4. 扫描与所有权验证</h2>
<ul>
<li>监测、多页面扫描和全站抓取仅适用于您已通过 DNS TXT 记录或 meta 标签<strong>验证</strong>所有权（或测试授权）的网站。请勿扫描您无权测试的网站。</li>
<li>免费单页扫描只能用于可公开访问的页面，并须遵守规定的频率限制。</li>
<li>您不得使用 Allyfolio 使系统过载、攻击或探测系统，或访问非公开地址。</li>
</ul>
<h2>5. 价格、付款和取消</h2>
<p>订单由我们的经销商和记录商户 <strong>Paddle</strong>（Paddle.com Market Ltd）处理，Paddle 负责付款、开票和增值税；购买时同样适用 Paddle 的买方条款。订阅按月预付，可随时取消，自当前计费周期结束时生效。升级立即生效并按比例收费；降级自下一个计费周期生效。单次报告（€49）包含对一个网站的一次扫描。除非另有说明，价格不含增值税。</p>
<h2>6. 可用性与变更</h2>
<p>我们力求高可用性，但不承诺服务不中断。定期扫描可能因维护或目标网站原因而延迟。只要您付费的核心服务没有实质性减少，我们可以更改功能；对本条款的重大变更，我们将至少提前 30 天通过电子邮件通知。</p>
<h2>7. 责任</h2>
<ul>
<li>对于故意和重大过失、对生命、身体或健康的伤害以及强制性产品责任法规定的情形，我们承担无限责任。</li>
<li>对于轻微过失，我们仅对违反主要合同义务承担责任，并以典型、可预见的损失为限。</li>
<li>在所有其他情况下，在法律允许的范围内，我们每个合同年度的总责任以您在引起索赔的事件发生前十二个月内为 Allyfolio 支付的费用为限（至少 €100）。</li>
<li>对于因您网站的无障碍状况而产生的罚款、第三方索赔或警告函，我们不承担责任，除非由我们的故意或重大过失造成。</li>
</ul>
<h2>8. 数据保护</h2>
<p>请参阅<a href="/zh/privacy">隐私政策</a>。当我们代表您处理个人数据时（例如被扫描页面的内容），适用<a href="/zh/dpa">数据处理协议</a>。</p>
<h2>9. 终止</h2>
<p>您可以随时在“设置”中删除账户；有效的订阅将同时取消。对于违反本条款（特别是第 4 条）的账户，我们可以暂停或终止。</p>
<h2>10. 最终条款</h2>
<p>适用德国法律，但排除《联合国国际货物销售合同公约》。对商人而言，管辖地为提供方的注册地。如某项条款无效，其余条款仍然有效。</p>` },
    dpa: { eyebrow: 'legal', title: '数据处理协议（模板）', description: 'Allyfolio 客户与 Allyfolio 之间关于被扫描网页中个人数据的数据处理协议模板（GDPR 第 28 条）。', html: `
<!-- TODO: have this DPA template reviewed before launch. -->
<p><em>模板。</em>当您使用 Allyfolio 时，本协议（依据 GDPR 第 28 条）适用于作为客户的您（“控制者”）与厦门妙尔多商贸有限公司（福建省厦门市思明区嘉禾路221号907室，详见<a href="/zh/imprint">网站信息</a>；“处理者”）之间。接受<a href="/zh/terms">服务条款</a>后，本协议即成为合同的一部分。如需签署版本，请发送邮件至 ${MAIL}。如中文版本与英文版本有出入，以英文版本为准。</p>
<h2>1. 处理的对象、期限和性质</h2>
<p>处理者扫描控制者已验证的网页，保存结果并为控制者创建报告。处理期限与合同期限相同，另加下述保存期限。</p>
<h2>2. 数据类型和数据主体</h2>
<ul>
<li>被扫描页面上恰好公开的个人数据（例如员工或其他人的姓名、电子邮件地址或照片），这些数据可能出现在随扫描结果保存的 HTML 片段、截图或页面标题中。</li>
<li>控制者邀请的团队成员的电子邮件地址和姓名。</li>
</ul>
<h2>3. 指示</h2>
<p>处理者仅根据控制者的书面指示（即控制台中对网站、扫描、报告和团队的配置）处理数据，除非欧盟或成员国法律另有要求。</p>
<h2>4. 保密</h2>
<p>所有有权访问数据的人员均负有保密义务。</p>
<h2>5. 安全措施（GDPR 第 32 条）</h2>
<ul>
<li>在欧盟托管（Hetzner，德国/芬兰）；所有访问均使用加密连接（TLS）。</li>
<li>仅在登录后才能访问控制台；密码以加盐哈希形式保存；会话可以结束；重置链接只能使用一次，60 分钟后失效。</li>
<li>按团队严格隔离客户数据；扫描网站前须验证所有权。</li>
<li>扫描器通过仅允许公开地址的出站代理与内部网络隔离。</li>
<li>每日备份，保存期限有限；扫描历史采用哈希链，可发现篡改。</li>
</ul>
<h2>6. 次级处理者</h2>
<p>控制者同意以下次级处理者：Hetzner Online GmbH（托管，德国）；Resend（事务性邮件，欧盟区域）；Cloudflare, Inc.（DNS 和入站邮件）。处理者会至少提前 30 天通过电子邮件告知计划中的变更；控制者可因重要理由提出异议并终止合同。</p>
<h2>7. 协助</h2>
<p>在处理性质允许的范围内，处理者协助控制者答复数据主体请求并履行 GDPR 第 32–36 条规定的义务。数据可随时从控制台导出。</p>
<h2>8. 个人数据泄露</h2>
<p>处理者在知悉影响控制者数据的个人数据泄露后，会立即通知控制者，并尽可能在 48 小时内通知。</p>
<h2>9. 删除和返还</h2>
<p>合同结束时，或控制者删除网站或账户时，处理者将删除数据。备份会在 30 天内被覆盖。删除前，控制者可以导出数据。</p>
<h2>10. 审计</h2>
<p>处理者提供证明其遵守 GDPR 第 28 条所需的信息，并允许合理的审计，通常以书面信息的方式进行，须至少提前 30 天通知。</p>` },
    imprint: { eyebrow: 'legal', title: '网站信息（Impressum）', description: 'allyfolio.com 的法定网站信息（Impressum）。', html: `
<h2>提供者</h2>
<p>厦门妙尔多商贸有限公司（Xiamen Miaoerduo Trading Co., Ltd.）<br />福建省厦门市思明区嘉禾路221号907室</p>
<p>在中华人民共和国注册的有限责任公司。<br />统一社会信用代码：91350203MAK7GQ50XC</p>
<h2>法定代表人</h2>
<p>白宇堃（Bai Yukun）</p>
<h2>联系方式</h2>
<p>邮箱：${MAIL}</p>` },
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
